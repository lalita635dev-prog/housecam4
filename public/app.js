// ==================== VARIABLES GLOBALES ====================
let ws = null;
let localStream = null;
let peerConnections = new Map();
let myId = null;
let authToken = null;
let currentUser = null;

// Variables para detección de movimiento
let motionDetectionEnabled = false;
let motionDetectionInterval = null;
let previousFrame = null;
let motionCanvas = null;
let motionContext = null;
let lastMotionAlert = 0;
const MOTION_THRESHOLD = 30;
const MOTION_PIXEL_THRESHOLD = 0.02;
const ALERT_COOLDOWN = 5000;

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ==================== INICIALIZACIÓN ====================
window.addEventListener('DOMContentLoaded', () => {
    setupCameraControls();
    
    document.getElementById('login-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });
});

window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (ws) ws.close();
});

// ==================== LOGIN ====================
async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const role = document.getElementById('login-role').value;

    if (!username || !password) {
        showStatus('login-status', 'Por favor completa todos los campos', 'error');
        return;
    }

    try {
        showStatus('login-status', 'Autenticando...', 'info');

        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });

        const data = await response.json();

        if (response.ok && data.token) {
            authToken = data.token;
            currentUser = { username: data.userId, role: data.role };
            localStorage.setItem('authToken', authToken);
            
            if (data.role === 'camera') {
                showCameraInterface();
            } else {
                showViewerInterface();
            }
        } else {
            showStatus('login-status', data.error || 'Credenciales inválidas', 'error');
        }
    } catch (error) {
        console.error('Error en login:', error);
        showStatus('login-status', 'Error de conexión con el servidor', 'error');
    }
}

function showCameraInterface() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('current-user').textContent = currentUser.username;
    document.getElementById('current-role').textContent = '📹 Cámara';
    selectMode('camera');
}

function showViewerInterface() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('current-user').textContent = currentUser.username;
    document.getElementById('current-role').textContent = '👁️ Viewer';
    selectMode('viewer');
    connectViewer();
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
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();

    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');

    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    showStatus('login-status', '', 'info');
}

// ==================== NAVEGACIÓN ====================
function selectMode(mode) {
    const buttons = document.querySelectorAll('.mode-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    if (mode === 'camera') {
        buttons[0].classList.add('active');
        document.getElementById('camera-section').classList.add('active');
        document.getElementById('viewer-section').classList.remove('active');
    } else {
        buttons[1].classList.add('active');
        document.getElementById('viewer-section').classList.add('active');
        document.getElementById('camera-section').classList.remove('active');
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
async function startCamera() {
    const cameraName = document.getElementById('camera-name').value.trim();
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
                type: 'authenticate',
                token: authToken
            }));
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'authenticated':
                    ws.send(JSON.stringify({
                        type: 'register-camera',
                        name: cameraName
                    }));
                    break;

                case 'registered':
                    myId = data.id;
                    console.log('✅ Cámara registrada con ID:', myId);
                    showStatus('camera-status', '✅ Transmitiendo', 'success');
                    document.getElementById('camera-info').classList.remove('hidden');
                    document.getElementById('camera-info').textContent = `📡 ${cameraName}`;
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

                case 'auth-failed':
                    showStatus('camera-status', '❌ Sesión expirada - Inicie sesión nuevamente', 'error');
                    setTimeout(logout, 2000);
                    break;

                case 'error':
                    showStatus('camera-status', `❌ ${data.message}`, 'error');
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
            type: 'authenticate',
            token: authToken
        }));
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        switch(data.type) {
            case 'authenticated':
                ws.send(JSON.stringify({
                    type: 'register-viewer'
                }));
                showStatus('viewer-status', '✅ Conectado', 'success');
                break;

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

            case 'auth-failed':
                showStatus('viewer-status', '❌ Sesión expirada - Inicie sesión nuevamente', 'error');
                setTimeout(logout, 2000);
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
    listEl.classList.remove('hidden');
    
    console.log('📹 Mostrando cámaras:', cameras);
    
    if (cameras.length === 0) {
        listEl.innerHTML = '<p style="text-align: center; color: #94a3b8;">No hay cámaras disponibles</p>';
        return;
    }

    listEl.innerHTML = cameras.map(cam => `
        <div class="camera-card" onclick="watchCamera('${cam.id}', '${cam.name}')">
            <h3>📹 ${cam.name}</h3>
            <p>👁️ ${cam.viewers} espectador(es)</p>
            <p style="margin-top: 5px; color: #6ee7b7;">🟢 En línea</p>
        </div>
    `).join('');
}

function watchCamera(cameraId, cameraName) {
    console.log('🎥 Solicitando ver cámara:', cameraId, cameraName);
    
    document.getElementById('cameras-list').classList.add('hidden');
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
    document.getElementById('cameras-list').classList.remove('hidden');
}

function disconnectViewer() {
    if (ws) {
        ws.close();
    }
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    document.getElementById('viewer-video').srcObject = null;
    document.getElementById('cameras-list').classList.add('hidden');
    document.getElementById('viewer-video-container').classList.add('hidden');
    showStatus('viewer-status', '', 'info');
}

// ==================== UTILIDADES ====================
function showStatus(elementId, message, type) {
    const statusEl = document.getElementById(elementId);
    if (!statusEl) return;
    
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
    if (!message) statusEl.style.display = 'none';
    else statusEl.style.display = 'block';
}