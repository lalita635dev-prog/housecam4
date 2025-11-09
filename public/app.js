// ==================== VARIABLES GLOBALES ====================
let ws = null;
let localStream = null;
let peerConnections = new Map();
let myId = null;
let authToken = null;
let cameraKey = null;
let currentUser = null;
let currentTab = 'viewer';
let currentAdminSection = 'users';
let editingUser = null;
let editingCamera = null;
let selectedCameraId = null;
let allCameraConfigs = [];

// Variables para detección de movimiento
let motionDetectionEnabled = false;
let motionDetectionInterval = null;
let previousFrame = null;
let motionCanvas = null;
let motionContext = null;
let lastMotionAlert = 0;
const MOTION_THRESHOLD = 30; // Sensibilidad (menor = más sensible)
const MOTION_PIXEL_THRESHOLD = 0.02; // 2% de píxeles deben cambiar
const ALERT_COOLDOWN = 5000; // 5 segundos entre alertas

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ==================== INICIALIZACIÓN ====================
window.addEventListener('DOMContentLoaded', async () => {
    setupCameraControls();

    const hasUserSession = await verifySession();
    if (hasUserSession) {
        showMainView();
        return;
    }

    const hasCameraSession = await verifyCameraKey();
    if (hasCameraSession) {
        showCameraView();
        return;
    }

    document.getElementById('login-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });

    document.getElementById('camera-key').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginCamera();
    });
});

window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (ws) ws.close();
});

// ==================== LOGIN ====================
function switchLoginMode(mode) {
    const buttons = document.querySelectorAll('.tab-selector button');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    if (mode === 'user') {
        document.getElementById('user-login').classList.remove('hidden');
        document.getElementById('camera-login').classList.add('hidden');
    } else {
        document.getElementById('user-login').classList.add('hidden');
        document.getElementById('camera-login').classList.remove('hidden');
    }
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showStatus('login-status', 'Por favor completa todos los campos', 'error');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            showMainView();
        } else {
            showStatus('login-status', data.error || 'Error al iniciar sesión', 'error');
        }
    } catch (error) {
        showStatus('login-status', 'Error de conexión con el servidor', 'error');
    }
}

async function loginCamera() {
    const key = document.getElementById('camera-key').value.trim();

    if (!key) {
        showStatus('camera-login-status', 'Por favor ingresa la clave', 'error');
        return;
    }

    try {
        const response = await fetch('/api/verify-camera-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });

        const data = await response.json();

        if (data.success) {
            cameraKey = key;
            localStorage.setItem('cameraKey', cameraKey);
            await loadCameraConfigs();
            showCameraView();
        } else {
            showStatus('camera-login-status', 'Clave incorrecta', 'error');
        }
    } catch (error) {
        showStatus('camera-login-status', 'Error de conexión', 'error');
    }
}

async function logout() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken })
        });
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
    }

    if (ws) ws.close();
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();

    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');

    document.getElementById('main-view').classList.remove('active');
    document.getElementById('login-view').classList.add('active');
}

function logoutCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (ws) ws.close();
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();

    cameraKey = null;
    localStorage.removeItem('cameraKey');

    document.getElementById('camera-view').classList.remove('active');
    document.getElementById('login-view').classList.add('active');
}

async function verifySession() {
    const token = localStorage.getItem('authToken');
    if (!token) return false;

    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });

        const data = await response.json();

        if (data.success) {
            authToken = token;
            currentUser = data.user;
            return true;
        }
    } catch (error) {
        console.error('Error verificando sesión:', error);
    }

    localStorage.removeItem('authToken');
    return false;
}

async function verifyCameraKey() {
    const key = localStorage.getItem('cameraKey');
    if (!key) return false;

    try {
        const response = await fetch('/api/verify-camera-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });

        const data = await response.json();

        if (data.success) {
            cameraKey = key;
            await loadCameraConfigs();
            return true;
        }
    } catch (error) {
        console.error('Error verificando clave:', error);
    }

    localStorage.removeItem('cameraKey');
    return false;
}

function showMainView() {
    document.getElementById('login-view').classList.remove('active');
    document.getElementById('main-view').classList.add('active');

    document.getElementById('user-badge').textContent = currentUser.username;
    
    if (currentUser.role === 'admin') {
        document.getElementById('role-badge').className = 'admin-badge';
        document.getElementById('role-badge').textContent = '👑 Admin';
        document.getElementById('admin-tab').classList.remove('hidden');
    } else {
        document.getElementById('role-badge').className = 'user-badge';
        document.getElementById('role-badge').textContent = '👤 Usuario';
    }

    connectViewer();
}

async function showCameraView() {
    document.getElementById('login-view').classList.remove('active');
    document.getElementById('camera-view').classList.add('active');

    const select = document.getElementById('camera-select');
    select.innerHTML = '<option value="">Cargando cámaras...</option>';
    
    setTimeout(() => {
        select.innerHTML = '<option value="">Selecciona una cámara...</option>';
        
        if (allCameraConfigs.length === 0) {
            select.innerHTML = '<option value="">No hay cámaras registradas</option>';
            showStatus('camera-status', 'No hay cámaras registradas en el sistema. Contacta al administrador.', 'error');
        } else {
            allCameraConfigs.forEach(cam => {
                const option = document.createElement('option');
                option.value = cam.id;
                option.textContent = `${cam.name}${cam.location ? ' - ' + cam.location : ''}`;
                select.appendChild(option);
            });
        }
    }, 500);
}

// ==================== NAVEGACIÓN ====================
function showTab(tabName) {
    currentTab = tabName;

    document.querySelectorAll('#main-tabs .tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    document.getElementById('viewer-tab').classList.add('hidden');
    document.getElementById('admin-tab-content').classList.add('hidden');

    if (tabName === 'viewer') {
        document.getElementById('viewer-tab').classList.remove('hidden');
    } else if (tabName === 'admin') {
        document.getElementById('admin-tab-content').classList.remove('hidden');
        loadUsers();
        loadCameraConfigsAdmin();
    }
}

function showAdminSection(section) {
    currentAdminSection = section;

    document.querySelectorAll('#admin-tab-content .tabs .tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    document.getElementById('admin-users').classList.add('hidden');
    document.getElementById('admin-cameras').classList.add('hidden');

    if (section === 'users') {
        document.getElementById('admin-users').classList.remove('hidden');
    } else if (section === 'cameras') {
        document.getElementById('admin-cameras').classList.remove('hidden');
    }
}

// ==================== CONTROLES DE CÁMARA ====================
function setupCameraControls() {
    document.getElementById('brightness').addEventListener('input', (e) => {
        document.getElementById('brightness-value').textContent = e.target.value;
        applyVideoFilters();
    });

    document.getElementById('contrast').addEventListener('input', (e) => {
        document.getElementById('contrast-value').textContent = e.target.value;
        applyVideoFilters();
    });

    document.getElementById('zoom').addEventListener('input', (e) => {
        document.getElementById('zoom-value').textContent = parseFloat(e.target.value).toFixed(1);
        applyVideoZoom();
    });

    document.getElementById('night-mode').addEventListener('change', (e) => {
        const video = document.getElementById('camera-preview');
        if (e.target.checked) {
            video.classList.add('night-mode');
            document.getElementById('brightness').value = 150;
            document.getElementById('brightness-value').textContent = '150';
            document.getElementById('contrast').value = 120;
            document.getElementById('contrast-value').textContent = '120';
        } else {
            video.classList.remove('night-mode');
            document.getElementById('brightness').value = 100;
            document.getElementById('brightness-value').textContent = '100';
            document.getElementById('contrast').value = 100;
            document.getElementById('contrast-value').textContent = '100';
        }
        applyVideoFilters();
    });
}

function applyVideoFilters() {
    const video = document.getElementById('camera-preview');
    const brightness = document.getElementById('brightness').value;
    const contrast = document.getElementById('contrast').value;
    const nightMode = document.getElementById('night-mode').checked;
    
    if (!nightMode) {
        video.style.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    }
}

function applyVideoZoom() {
    const video = document.getElementById('camera-preview');
    const zoom = document.getElementById('zoom').value;
    video.style.transform = `scale(${zoom})`;
    video.style.transformOrigin = 'center center';
}

// ==================== DETECCIÓN DE MOVIMIENTO ====================
function initMotionDetection() {
    motionCanvas = document.createElement('canvas');
    motionContext = motionCanvas.getContext('2d', { willReadFrequently: true });
}

function detectMotion() {
    const video = document.getElementById('camera-preview');
    
    if (!video.videoWidth || !video.videoHeight) {
        return;
    }

    if (motionCanvas.width !== video.videoWidth || motionCanvas.height !== video.videoHeight) {
        motionCanvas.width = video.videoWidth;
        motionCanvas.height = video.videoHeight;
    }

    motionContext.drawImage(video, 0, 0, motionCanvas.width, motionCanvas.height);
    const currentFrame = motionContext.getImageData(0, 0, motionCanvas.width, motionCanvas.height);

    if (!previousFrame) {
        previousFrame = currentFrame;
        return;
    }

    let motionPixels = 0;
    const totalPixels = currentFrame.data.length / 4;

    for (let i = 0; i < currentFrame.data.length; i += 4) {
        const diff = Math.abs(currentFrame.data[i] - previousFrame.data[i]) +
                     Math.abs(currentFrame.data[i + 1] - previousFrame.data[i + 1]) +
                     Math.abs(currentFrame.data[i + 2] - previousFrame.data[i + 2]);

        if (diff > MOTION_THRESHOLD) {
            motionPixels++;
        }
    }

    const motionPercentage = motionPixels / totalPixels;

    if (motionPercentage > MOTION_PIXEL_THRESHOLD) {
        const now = Date.now();
        if (now - lastMotionAlert > ALERT_COOLDOWN) {
            console.log(`🚨 Movimiento detectado: ${(motionPercentage * 100).toFixed(2)}%`);
            sendMotionAlert();
            lastMotionAlert = now;
            showMotionIndicator();
        }
    }

    previousFrame = currentFrame;
}

function sendMotionAlert() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'motion-detected'
        }));
    }
}

function showMotionIndicator() {
    const indicator = document.getElementById('motion-indicator');
    if (indicator) {
        indicator.style.display = 'block';
        setTimeout(() => {
            indicator.style.display = 'none';
        }, 2000);
    }
}

function toggleMotionDetection() {
    motionDetectionEnabled = !motionDetectionEnabled;
    const btn = document.getElementById('motion-detection-toggle');
    const status = document.getElementById('motion-status');
    
    if (motionDetectionEnabled) {
        initMotionDetection();
        motionDetectionInterval = setInterval(detectMotion, 500);
        btn.textContent = '⏸️ Pausar Detección';
        btn.classList.add('active');
        status.textContent = '🟢 Activa';
        status.style.color = '#6ee7b7';
        showStatus('camera-status', '✅ Detección de movimiento activada', 'success');
        
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    } else {
        if (motionDetectionInterval) {
            clearInterval(motionDetectionInterval);
            motionDetectionInterval = null;
        }
        btn.textContent = '▶️ Iniciar Detección';
        btn.classList.remove('active');
        status.textContent = '⚫ Inactiva';
        status.style.color = '#64748b';
        previousFrame = null;
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showStatus('viewer-status', '✅ Notificaciones activadas', 'success');
                setTimeout(() => {
                    showStatus('viewer-status', '✅ Conectado', 'success');
                }, 2000);
            }
        });
    }
}

function handleMotionAlert(data) {
    console.log('🚨 Alerta de movimiento recibida:', data.cameraName);
    
    if (Notification.permission === 'granted') {
        new Notification('🚨 Movimiento Detectado', {
            body: `Cámara: ${data.cameraName}\n${new Date(data.timestamp).toLocaleTimeString()}`,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="70" font-size="70">🔴</text></svg>',
            tag: data.cameraId,
            requireInteraction: false
        });
    }
    
    const alertsContainer = document.getElementById('motion-alerts-list');
    if (alertsContainer) {
        const alertEl = document.createElement('div');
        alertEl.className = 'motion-alert-item';
        alertEl.innerHTML = `
            <span class="alert-icon">🚨</span>
            <div class="alert-content">
                <strong>${data.cameraName}</strong>
                <small>${new Date(data.timestamp).toLocaleTimeString()}</small>
            </div>
        `;
        alertsContainer.insertBefore(alertEl, alertsContainer.firstChild);
        
        while (alertsContainer.children.length > 10) {
            alertsContainer.removeChild(alertsContainer.lastChild);
        }
        
        setTimeout(() => {
            if (alertEl.parentNode) {
                alertEl.remove();
            }
        }, 10000);
    }
    
    showStatus('viewer-status', `🚨 Movimiento en ${data.cameraName}`, 'error');
    setTimeout(() => {
        showStatus('viewer-status', '✅ Conectado', 'success');
    }, 3000);
}

// ==================== CÁMARA ====================
async function loadCameraConfigs() {
    try {
        const response = await fetch('/api/camera-configs', {
            headers: { 'Authorization': `Bearer ${cameraKey}` }
        });
        
        if (!response.ok) {
            console.error('Error al cargar cámaras:', response.status);
            allCameraConfigs = [];
            return;
        }
        
        const data = await response.json();
        allCameraConfigs = data.cameras || [];
        console.log('Cámaras cargadas:', allCameraConfigs.length);
    } catch (error) {
        console.error('Error cargando configuraciones:', error);
        allCameraConfigs = [];
    }
}

async function startCamera() {
    selectedCameraId = document.getElementById('camera-select').value;
    
    if (!selectedCameraId) {
        showStatus('camera-status', 'Por favor selecciona una cámara', 'error');
        return;
    }

    const quality = document.getElementById('video-quality').value;

    try {
        showStatus('camera-status', 'Solicitando acceso a la cámara...', 'info');

        let videoConfig = {};
        switch(quality) {
            case 'high':
                videoConfig = {
                    facingMode: 'environment',
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 },
                    frameRate: { ideal: 30, min: 20 },
                    aspectRatio: 16/9
                };
                break;
            case 'low':
                videoConfig = {
                    facingMode: 'environment',
                    width: { ideal: 854, max: 854 },
                    height: { ideal: 480, max: 480 },
                    frameRate: { ideal: 20, min: 15 },
                    aspectRatio: 16/9
                };
                break;
            default:
                videoConfig = {
                    facingMode: 'environment',
                    width: { ideal: 1280, min: 854 },
                    height: { ideal: 720, min: 480 },
                    frameRate: { ideal: 25, min: 15 },
                    aspectRatio: 16/9
                };
        }

        localStream = await navigator.mediaDevices.getUserMedia({
            video: videoConfig,
            audio: false
        });

        document.getElementById('camera-preview').srcObject = localStream;
        applyVideoFilters();
        applyVideoZoom();

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: 'register-camera',
                cameraId: selectedCameraId,
                key: cameraKey
            }));
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'registered':
                    myId = data.id;
                    const cameraName = data.name;
                    console.log('✅ Cámara registrada con ID:', myId);
                    showStatus('camera-status', '✅ Transmitiendo', 'success');
                    document.getElementById('camera-info').classList.remove('hidden');
                    document.getElementById('camera-info').textContent = `📡 ${cameraName}`;
                    document.getElementById('camera-name-display').textContent = cameraName;
                    document.getElementById('start-camera-btn').classList.add('hidden');
                    document.getElementById('stop-camera-btn').classList.remove('hidden');
                    document.getElementById('motion-controls').classList.remove('hidden');
                    break;
                case 'viewer-joined':
                    console.log('👁️ Viewer conectado:', data.viewerId);
                    await createPeerConnection(data.viewerId);
                    break;
                case 'answer':
                    const pc = peerConnections.get(data.from);
                    if (pc) {
                        console.log('📥 Respuesta recibida de viewer:', data.from);
                        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                    }
                    break;
                case 'ice-candidate':
                    const peerConn = peerConnections.get(data.from);
                    if (peerConn && data.candidate) {
                        console.log('🧊 ICE candidate de:', data.from);
                        await peerConn.addIceCandidate(new RTCIceCandidate(data.candidate));
                    }
                    break;
                case 'error':
                    showStatus('camera-status', `❌ ${data.message}`, 'error');
                    stopCamera();
                    break;
            }
        };

        ws.onerror = () => {
            showStatus('camera-status', '❌ Error de conexión', 'error');
        };

    } catch (error) {
        showStatus('camera-status', `❌ Error: ${error.message}`, 'error');
    }
}

async function createPeerConnection(viewerId) {
    console.log('🔗 Creando conexión peer para viewer:', viewerId);
    
    const pc = new RTCPeerConnection(iceServers);
    peerConnections.set(viewerId, pc);

    const quality = document.getElementById('video-quality').value;
    let maxBitrate, maxFramerate;
    
    switch(quality) {
        case 'high':
            maxBitrate = 2500000;
            maxFramerate = 30;
            break;
        case 'low':
            maxBitrate = 800000;
            maxFramerate = 20;
            break;
        default:
            maxBitrate = 1500000;
            maxFramerate = 25;
    }

    localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStream);
        
        if (track.kind === 'video') {
            const params = sender.getParameters();
            if (!params.encodings) {
                params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = maxBitrate;
            params.encodings[0].maxFramerate = maxFramerate;
            sender.setParameters(params).catch(e => console.log('Error setting params:', e));
        }
    });

    pc.onicecandidate = (event) => {
        if (event.candidate && ws) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                target: viewerId,
                from: myId
            }));
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('🔗 Estado conexión con viewer:', pc.connectionState);
    };

    const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
    });
    await pc.setLocalDescription(offer);

    console.log('📤 Enviando oferta a viewer:', viewerId, 'desde cámara:', myId);

    ws.send(JSON.stringify({
        type: 'offer',
        offer: offer,
        target: viewerId,
        from: myId
    }));

    document.getElementById('camera-info').textContent = `📡 ${peerConnections.size} espectador(es)`;
}

function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (ws) {
        ws.close();
    }
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    if (motionDetectionInterval) {
        clearInterval(motionDetectionInterval);
        motionDetectionInterval = null;
    }
    motionDetectionEnabled = false;
    previousFrame = null;
    document.getElementById('motion-controls').classList.add('hidden');
    
    document.getElementById('camera-preview').srcObject = null;
    document.getElementById('camera-info').classList.add('hidden');
    document.getElementById('start-camera-btn').classList.remove('hidden');
    document.getElementById('stop-camera-btn').classList.add('hidden');
    document.getElementById('camera-name-display').textContent = '';
    showStatus('camera-status', '', 'info');
}

// ==================== VISUALIZADOR ====================
function connectViewer() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        return;
    }

    showStatus('viewer-status', 'Conectando...', 'info');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'register-viewer',
            token: authToken
        }));
        showStatus('viewer-status', '✅ Conectado', 'success');
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        switch(data.type) {
            case 'registered':
                myId = data.id;
                console.log('✅ Viewer registrado con ID:', myId);
                document.getElementById('motion-alerts-panel').classList.remove('hidden');
                requestNotificationPermission();
                break;
            case 'camera-list':
                displayCameras(data.cameras);
                break;
            case 'offer':
                await handleOffer(data.offer, data.from);
                break;
            case 'ice-candidate':
                const pc = peerConnections.get(data.from);
                if (pc && data.candidate) {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
                break;
            case 'camera-disconnected':
                showStatus('viewer-status', '❌ La cámara se desconectó', 'error');
                backToCameraList();
                break;
            case 'motion-alert':
                handleMotionAlert(data);
                break;
            case 'error':
                showStatus('viewer-status', `❌ ${data.message}`, 'error');
                break;
        }
    };

    ws.onerror = () => {
        showStatus('viewer-status', '❌ Error de conexión', 'error');
    };
}

function displayCameras(cameras) {
    const listEl = document.getElementById('cameras-list');
    
    console.log('📹 Mostrando cámaras:', cameras);
    
    if (cameras.length === 0) {
        listEl.innerHTML = '<p style="text-align: center; color: #94a3b8;">No hay cámaras disponibles o no tienes permisos asignados</p>';
        return;
    }

    listEl.innerHTML = cameras.map(cam => `
        <div class="camera-card" onclick="watchCamera('${cam.id}', '${cam.name}')">
            <h3>📹 ${cam.name}</h3>
            ${cam.location ? `<p>📍 ${cam.location}</p>` : ''}
            ${cam.description ? `<p>💬 ${cam.description}</p>` : ''}
            <p>👁️ ${cam.viewers} espectador(es)</p>
            <p style="margin-top: 5px; color: #6ee7b7;">🟢 En línea</p>
        </div>
    `).join('');
}

function watchCamera(cameraId, cameraName) {
    console.log('🎥 Solicitando ver cámara:', cameraId, cameraName);
    
    document.getElementById('cameras-list').style.display = 'none';
    document.getElementById('viewer-video-container').classList.remove('hidden');
    document.getElementById('viewer-info').textContent = `📹 ${cameraName}`;

    ws.send(JSON.stringify({
        type: 'request-camera',
        cameraId: cameraId
    }));
    
    console.log('📤 Solicitud enviada al servidor');
}

async function handleOffer(offer, cameraId) {
    console.log('📥 Recibida oferta de cámara:', cameraId, 'Mi ID:', myId);
    
    const pc = new RTCPeerConnection(iceServers);
    peerConnections.set(cameraId, pc);

    pc.ontrack = (event) => {
        console.log('✅ Stream recibido de cámara:', cameraId);
        const video = document.getElementById('viewer-video');
        video.srcObject = event.streams[0];
        video.onloadedmetadata = () => {
            console.log('▶️ Reproduciendo video');
            video.play().catch(e => console.log('Error playing video:', e));
        };
    };

    pc.onicecandidate = (event) => {
        if (event.candidate && ws) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                target: cameraId,
                from: myId
            }));
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('🔗 Estado de conexión:', pc.connectionState);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
    });
    await pc.setLocalDescription(answer);

    console.log('📤 Enviando respuesta a cámara:', cameraId, 'desde viewer:', myId);
    
    ws.send(JSON.stringify({
        type: 'answer',
        answer: answer,
        target: cameraId,
        from: myId
    }));
}

function backToCameraList() {
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    document.getElementById('viewer-video').srcObject = null;
    document.getElementById('viewer-video-container').classList.add('hidden');
    document.getElementById('cameras-list').style.display = 'grid';
}

// ==================== ADMIN - USUARIOS ====================
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        if (data.users) {
            displayUsers(data.users);
        }
    } catch (error) {
        document.getElementById('users-list').innerHTML = 
            '<p style="text-align: center; color: #ef4444;">Error cargando usuarios</p>';
    }
}

function displayUsers(users) {
    if (users.length === 0) {
        document.getElementById('users-list').innerHTML = 
            '<p style="text-align: center; color: #94a3b8;">No hay usuarios registrados</p>';
        return;
    }

    const table = `
        <table class="table">
            <thead>
                <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Cámaras</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(user => `
                    <tr>
                        <td>${user.username}</td>
                        <td>${user.role === 'admin' ? '👑 Admin' : '👤 Usuario'}</td>
                        <td>${user.role === 'admin' ? 'Todas' : (user.allowedCameras.length || 'Ninguna')}</td>
                        <td>
                            ${user.username !== 'admin' ? `
                                <button class="btn btn-secondary btn-small" onclick="editUser('${user.username}')">Editar</button>
                                <button class="btn btn-danger btn-small" onclick="deleteUser('${user.username}')">Eliminar</button>
                            ` : '<span style="color: #64748b;">-</span>'}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    document.getElementById('users-list').innerHTML = table;
}

async function showUserModal(username = null) {
    editingUser = username;
    document.getElementById('user-modal-title').textContent = username ? 'Editar Usuario' : 'Crear Usuario';
    document.getElementById('modal-username').value = username || '';
    document.getElementById('modal-password').value = '';
    document.getElementById('modal-username').disabled = !!username;

    await loadCameraConfigsForModal();

    document.getElementById('user-modal').classList.remove('hidden');
}

async function loadCameraConfigsForModal() {
    try {
        const response = await fetch('/api/admin/camera-configs', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        const cameras = data.cameras || [];

        let userCameras = [];
        if (editingUser) {
            const userResponse = await fetch('/api/admin/users', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const userData = await userResponse.json();
            const user = userData.users.find(u => u.username === editingUser);
            if (user) {
                userCameras = user.allowedCameras;
            }
        }

        const checkboxesContainer = document.getElementById('cameras-checkboxes');
        
        if (cameras.length === 0) {
            checkboxesContainer.innerHTML = '<p style="color: #94a3b8;">No hay cámaras registradas. Crea cámaras primero en la pestaña "📹 Cámaras"</p>';
        } else {
            checkboxesContainer.innerHTML = cameras.map(cam => `
                <label>
                    <input type="checkbox" value="${cam.id}" ${userCameras.includes(cam.id) ? 'checked' : ''}>
                    ${cam.name} ${cam.isActive ? '🟢' : '⚫'}
                </label>
            `).join('');
        }
    } catch (error) {
        console.error('Error cargando cámaras:', error);
    }
}

function closeUserModal() {
    document.getElementById('user-modal').classList.add('hidden');
    document.getElementById('modal-status').innerHTML = '';
    editingUser = null;
}

async function saveUser() {
    const username = document.getElementById('modal-username').value.trim();
    const password = document.getElementById('modal-password').value;
    
    const checkboxes = document.querySelectorAll('#cameras-checkboxes input[type="checkbox"]:checked');
    const allowedCameras = Array.from(checkboxes).map(cb => cb.value);

    if (!username) {
        showStatus('modal-status', 'El nombre de usuario es requerido', 'error');
        return;
    }

    if (!editingUser && !password) {
        showStatus('modal-status', 'La contraseña es requerida', 'error');
        return;
    }

    try {
        const url = editingUser 
            ? `/api/admin/users/${editingUser}` 
            : '/api/admin/users';
        
        const method = editingUser ? 'PUT' : 'POST';
        
        const body = { allowedCameras };
        if (!editingUser) {
            body.username = username;
        }
        if (password) {
            body.password = password;
        }

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.success) {
            showStatus('modal-status', `✅ ${data.message}`, 'success');
            setTimeout(() => {
                closeUserModal();
                loadUsers();
            }, 1500);
        } else {
            showStatus('modal-status', `❌ ${data.error}`, 'error');
        }
    } catch (error) {
        showStatus('modal-status', '❌ Error de conexión', 'error');
    }
}

async function editUser(username) {
    showUserModal(username);
}

async function deleteUser(username) {
    if (!confirm(`¿Estás seguro de eliminar al usuario "${username}"?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${username}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await response.json();

        if (data.success) {
            loadUsers();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        alert('Error de conexión');
    }
}

// ==================== ADMIN - CÁMARAS ====================
async function loadCameraConfigsAdmin() {
    try {
        const response = await fetch('/api/admin/camera-configs', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        if (data.cameras) {
            displayCameraConfigs(data.cameras);
        }
    } catch (error) {
        document.getElementById('cameras-config-list').innerHTML = 
            '<p style="text-align: center; color: #ef4444;">Error cargando cámaras</p>';
    }
}

function displayCameraConfigs(cameras) {
    if (cameras.length === 0) {
        document.getElementById('cameras-config-list').innerHTML = 
            '<p style="text-align: center; color: #94a3b8;">No hay cámaras registradas</p>';
        return;
    }

    const table = `
        <table class="table">
            <thead>
                <tr>
                    <th>Nombre</th>
                    <th>Ubicación</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${cameras.map(cam => `
                    <tr>
                        <td><strong>${cam.name}</strong><br><small style="color: #94a3b8;">${cam.description || 'Sin descripción'}</small></td>
                        <td>${cam.location || 'Sin ubicación'}</td>
                        <td>${cam.isActive ? '<span style="color: #6ee7b7;">🟢 Activa</span>' : '<span style="color: #64748b;">⚫ Inactiva</span>'}</td>
                        <td>
                            <button class="btn btn-secondary btn-small" onclick="editCamera('${cam.id}')">Editar</button>
                            <button class="btn btn-danger btn-small" onclick="deleteCamera('${cam.id}')">Eliminar</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    document.getElementById('cameras-config-list').innerHTML = table;
}

function showCameraModal(cameraId = null) {
    editingCamera = cameraId;
    document.getElementById('camera-modal-title').textContent = cameraId ? 'Editar Cámara' : 'Registrar Cámara';
    
    if (cameraId) {
        const camera = allCameraConfigs.find(c => c.id === cameraId);
        if (camera) {
            document.getElementById('modal-camera-name').value = camera.name;
            document.getElementById('modal-camera-location').value = camera.location || '';
            document.getElementById('modal-camera-description').value = camera.description || '';
        }
    } else {
        document.getElementById('modal-camera-name').value = '';
        document.getElementById('modal-camera-location').value = '';
        document.getElementById('modal-camera-description').value = '';
    }

    document.getElementById('camera-modal').classList.remove('hidden');
}

function closeCameraModal() {
    document.getElementById('camera-modal').classList.add('hidden');
    document.getElementById('camera-modal-status').innerHTML = '';
    editingCamera = null;
}

async function saveCameraConfig() {
    const name = document.getElementById('modal-camera-name').value.trim();
    const location = document.getElementById('modal-camera-location').value.trim();
    const description = document.getElementById('modal-camera-description').value.trim();

    if (!name) {
        showStatus('camera-modal-status', 'El nombre es requerido', 'error');
        return;
    }

    try {
        const url = editingCamera 
            ? `/api/admin/camera-configs/${editingCamera}` 
            : '/api/admin/camera-configs';
        
        const method = editingCamera ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, location, description })
        });

        const data = await response.json();

        if (data.success) {
            showStatus('camera-modal-status', `✅ ${data.message}`, 'success');
            setTimeout(() => {
                closeCameraModal();
                loadCameraConfigsAdmin();
            }, 1500);
        } else {
            showStatus('camera-modal-status', `❌ ${data.error}`, 'error');
        }
    } catch (error) {
        showStatus('camera-modal-status', '❌ Error de conexión', 'error');
    }
}

async function editCamera(cameraId) {
    await loadCameraConfigsAdmin();
    const response = await fetch('/api/admin/camera-configs', {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await response.json();
    allCameraConfigs = data.cameras || [];
    
    showCameraModal(cameraId);
}

async function deleteCamera(cameraId) {
    if (!confirm('¿Estás seguro de eliminar esta cámara? Se eliminará de todos los permisos de usuarios.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/camera-configs/${cameraId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await response.json();

        if (data.success) {
            loadCameraConfigsAdmin();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        alert('Error de conexión');
    }
}

// ==================== UTILIDADES ====================
function showStatus(elementId, message, type) {
    const statusEl = document.getElementById(elementId);
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
    if (!message) statusEl.style.display = 'none';
    else statusEl.style.display = 'block';
}