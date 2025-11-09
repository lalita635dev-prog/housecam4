// Servidor de señalización WebRTC con autenticación
const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// ============ CONFIGURACIÓN DE AUTENTICACIÓN CON VARIABLES DE ENTORNO ============
// Función para hashear contraseñas
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Cargar usuarios desde variables de entorno
function loadUsersFromEnv() {
  const users = {
    cameras: {},
    viewers: {}
  };

  // Formato de variables de entorno:
  // CAMERA_1=username:password
  // VIEWER_1=username:password
  // etc.

  // Cargar cámaras
  let cameraIndex = 1;
  while (process.env[`CAMERA_${cameraIndex}`]) {
    const [username, password] = process.env[`CAMERA_${cameraIndex}`].split(':');
    if (username && password) {
      users.cameras[username] = hashPassword(password);
      console.log(`✅ Cámara cargada: ${username}`);
    }
    cameraIndex++;
  }

  // Cargar viewers
  let viewerIndex = 1;
  while (process.env[`VIEWER_${viewerIndex}`]) {
    const [username, password] = process.env[`VIEWER_${viewerIndex}`].split(':');
    if (username && password) {
      users.viewers[username] = hashPassword(password);
      console.log(`✅ Viewer cargado: ${username}`);
    }
    viewerIndex++;
  }

  // Si no hay usuarios en variables de entorno, usar valores por defecto (SOLO PARA DESARROLLO)
  if (Object.keys(users.cameras).length === 0 && Object.keys(users.viewers).length === 0) {
    console.warn('⚠️  ADVERTENCIA: Usando credenciales por defecto. Configura variables de entorno en producción.');
    users.cameras = {
      'camera_demo': hashPassword('demo123'),
    };
    users.viewers = {
      'viewer_demo': hashPassword('demo123'),
    };
  }

  return users;
}

const USERS = loadUsersFromEnv();

// Tokens de sesión activos
const activeSessions = new Map(); // token -> {userId, role, expiresAt}

// Generar token de sesión
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Verificar token
function verifyToken(token) {
  const session = activeSessions.get(token);
  if (!session) return null;
  
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  
  return session;
}

// ============ ENDPOINTS DE AUTENTICACIÓN ============
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;
  
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  
  if (role !== 'camera' && role !== 'viewer') {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  
  const userDb = role === 'camera' ? USERS.cameras : USERS.viewers;
  const hashedPassword = hashPassword(password);
  
  if (!userDb[username] || userDb[username] !== hashedPassword) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  
  // Crear sesión
  const token = generateToken();
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 horas
  
  activeSessions.set(token, {
    userId: username,
    role: role,
    expiresAt: expiresAt
  });
  
  res.json({
    token: token,
    userId: username,
    role: role,
    expiresAt: expiresAt
  });
});

app.post('/api/logout', (req, res) => {
  const { token } = req.body;
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ success: true });
});

app.get('/ping', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cameras: cameras.size,
    viewers: viewers.size,
    sessions: activeSessions.size
  });
});

// ============ SERVIDOR WEBSOCKET ============
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Usuarios cargados:`);
  console.log(`   - Cámaras: ${Object.keys(USERS.cameras).length}`);
  console.log(`   - Viewers: ${Object.keys(USERS.viewers).length}`);
  
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n=== MODO DESARROLLO ===');
    console.log('Credenciales de prueba:');
    console.log('  Cámara: camera_demo / demo123');
    console.log('  Viewer: viewer_demo / demo123');
    console.log('=======================\n');
  }
});

const wss = new WebSocket.Server({ server });

const cameras = new Map();
const viewers = new Map();

wss.on('connection', (ws) => {
  const connectionId = uuidv4();
  let authenticated = false;
  let userSession = null;
  
  console.log(`Nueva conexión: ${connectionId}`);

  // Timeout de autenticación (10 segundos)
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Timeout de autenticación'
      }));
      ws.close();
    }
  }, 10000);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Primer mensaje debe ser autenticación
      if (!authenticated && data.type !== 'authenticate') {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Debe autenticarse primero'
        }));
        return;
      }
      
      switch(data.type) {
        case 'authenticate':
          clearTimeout(authTimeout);
          const session = verifyToken(data.token);
          
          if (!session) {
            ws.send(JSON.stringify({
              type: 'auth-failed',
              message: 'Token inválido o expirado'
            }));
            ws.close();
            return;
          }
          
          authenticated = true;
          userSession = session;
          
          ws.send(JSON.stringify({
            type: 'authenticated',
            userId: session.userId,
            role: session.role
          }));
          
          console.log(`Autenticado: ${session.userId} (${session.role})`);
          break;

        case 'register-camera':
          if (userSession.role !== 'camera') {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'No autorizado para transmitir'
            }));
            return;
          }
          
          cameras.set(connectionId, {
            ws,
            name: data.name || `Cámara ${cameras.size + 1}`,
            userId: userSession.userId,
            viewers: new Set()
          });
          
          ws.send(JSON.stringify({
            type: 'registered',
            id: connectionId,
            role: 'camera'
          }));
          
          broadcastCameraList();
          console.log(`Cámara registrada: ${data.name} (${userSession.userId})`);
          break;

        case 'register-viewer':
          if (userSession.role !== 'viewer') {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'No autorizado para ver'
            }));
            return;
          }
          
          viewers.set(connectionId, {
            ws,
            userId: userSession.userId,
            watchingCamera: null
          });
          
          ws.send(JSON.stringify({
            type: 'registered',
            id: connectionId,
            role: 'viewer'
          }));
          
          sendCameraList(ws);
          console.log(`Viewer registrado: ${userSession.userId}`);
          break;

        case 'request-camera':
          const camera = cameras.get(data.cameraId);
          if (camera) {
            const viewer = viewers.get(connectionId);
            if (viewer) {
              viewer.watchingCamera = data.cameraId;
              camera.viewers.add(connectionId);
              
              camera.ws.send(JSON.stringify({
                type: 'viewer-joined',
                viewerId: connectionId
              }));
            }
          }
          break;

        case 'motion-detected':
          if (userSession.role !== 'camera') {
            return;
          }
          
          const motionCamera = cameras.get(connectionId);
          if (motionCamera) {
            console.log(`🚨 Movimiento detectado en: ${motionCamera.name}`);
            
            // Enviar notificación a todos los viewers conectados
            viewers.forEach(viewer => {
              viewer.ws.send(JSON.stringify({
                type: 'motion-alert',
                cameraId: connectionId,
                cameraName: motionCamera.name,
                timestamp: new Date().toISOString()
              }));
            });
            
            // También enviar a viewers que estén viendo esta cámara
            motionCamera.viewers.forEach(viewerId => {
              const viewer = viewers.get(viewerId);
              if (viewer) {
                viewer.ws.send(JSON.stringify({
                  type: 'motion-alert',
                  cameraId: connectionId,
                  cameraName: motionCamera.name,
                  timestamp: new Date().toISOString()
                }));
              }
            });
          }
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          const targetId = data.target;
          const targetCamera = cameras.get(targetId);
          const targetViewer = viewers.get(targetId);
          
          if (targetCamera) {
            targetCamera.ws.send(JSON.stringify({
              ...data,
              from: connectionId
            }));
          } else if (targetViewer) {
            targetViewer.ws.send(JSON.stringify({
              ...data,
              from: connectionId
            }));
          }
          break;
      }
    } catch (error) {
      console.error('Error procesando mensaje:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error procesando solicitud'
      }));
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    
    if (cameras.has(connectionId)) {
      const camera = cameras.get(connectionId);
      camera.viewers.forEach(viewerId => {
        const viewer = viewers.get(viewerId);
        if (viewer) {
          viewer.ws.send(JSON.stringify({
            type: 'camera-disconnected',
            cameraId: connectionId
          }));
        }
      });
      cameras.delete(connectionId);
      broadcastCameraList();
      console.log(`Cámara desconectada: ${connectionId}`);
    }
    
    if (viewers.has(connectionId)) {
      const viewer = viewers.get(connectionId);
      if (viewer.watchingCamera) {
        const camera = cameras.get(viewer.watchingCamera);
        if (camera) {
          camera.viewers.delete(connectionId);
        }
      }
      viewers.delete(connectionId);
      console.log(`Viewer desconectado: ${connectionId}`);
    }
  });
});

function sendCameraList(ws) {
  const cameraList = Array.from(cameras.entries()).map(([id, camera]) => ({
    id,
    name: camera.name,
    viewers: camera.viewers.size
  }));
  
  ws.send(JSON.stringify({
    type: 'camera-list',
    cameras: cameraList
  }));
}

function broadcastCameraList() {
  const cameraList = Array.from(cameras.entries()).map(([id, camera]) => ({
    id,
    name: camera.name,
    viewers: camera.viewers.size
  }));
  
  const message = JSON.stringify({
    type: 'camera-list',
    cameras: cameraList
  });
  
  viewers.forEach(viewer => {
    viewer.ws.send(message);
  });
}

// Limpiar sesiones expiradas cada hora
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (now > session.expiresAt) {
      activeSessions.delete(token);
    }
  }
}, 60 * 60 * 1000);