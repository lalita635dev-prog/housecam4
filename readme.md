# 🎥 Sistema de Vigilancia con WebRTC - V4

Sistema de vigilancia en tiempo real con autenticación y **detección de movimiento**, usando WebRTC para streaming de video peer-to-peer.

## 🆕 Nueva Funcionalidad - Detección de Movimiento

✅ **Análisis de video en tiempo real** - Detecta cambios entre frames  
✅ **Notificaciones instantáneas** - Alertas push del navegador  
✅ **Lista de alertas en vivo** - Historial de movimientos detectados  
✅ **Configurable** - Ajusta sensibilidad y tiempo entre alertas  

## 🔐 Características de Seguridad

- ✅ **Autenticación con contraseña** - Login obligatorio para acceder
- ✅ **Tokens de sesión** - Sesiones válidas por 24 horas
- ✅ **Control de acceso basado en roles** - Cámaras vs Viewers
- ✅ **Timeout de autenticación** - 10 segundos para autenticarse
- ✅ **Limpieza automática de sesiones** - Sesiones expiradas se eliminan

## 📝 Estructura del Proyecto

```
sistema-vigilancia/
├── server.js           # Servidor con autenticación y WebSocket
├── package.json        # Dependencias
├── README.md          # Este archivo
└── public/
    ├── index.html     # Frontend con login y controles
    └── app.js         # Lógica del cliente y detección de movimiento
```

## 🛠️ Tecnologías

- **Backend:** Node.js, Express, WebSocket
- **Frontend:** Vanilla JavaScript, WebRTC
- **Detección:** Canvas API para análisis de frames
- **Notificaciones:** Notification API del navegador


## 🔒 Permisos Necesarios

- **Cámara:** Acceso a la cámara del dispositivo
- **Notificaciones:** Permiso para notificaciones push del navegador

El sistema solicitará estos permisos automáticamente.

## 📞 Soporte

Para problemas o preguntas, contacta al desarrollador.

## 📄 Licencia

MIT License - Úsalo libremente para tus proyectos.

---
