import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import apiRoutes from './routes/api.js';
import { loadData, runSyncScript } from './services/dataStore.js';
import { apiLimiter, errorHandler } from './middleware/security.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;
const AUTO_SYNC_SEC = parseInt(process.env.AUTO_SYNC_INTERVAL_SEC || '30', 10);

// 1. Cabeceras HTTP de seguridad con Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 2. Configuración segura de CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null;

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir llamadas sin cabecera origin (curl, scripts internos, health checks locales)
    if (!origin) return callback(null, true);
    if (!allowedOrigins) {
      // En modo local o desarrollo, permitir orígenes de red
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Petición bloqueada por política de seguridad CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true
};
app.use(cors(corsOptions));

// 3. Limitación de tamaño de payload para mitigar ataques DoS
app.use(express.json({ limit: '100mb' }));

// 4. Rate Limiting general para la API
app.use('/api', apiLimiter);

// 5. Rutas de la API
app.use('/api', apiRoutes);

// Endpoint de verificación informativa
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    system: 'Control de Acceso Anviz CrossChex API',
    version: '1.1.0',
    platform: process.platform,
    endpoints: [
      '/api/health',
      '/api/stats',
      '/api/fichadas',
      '/api/empleados',
      '/api/departamentos',
      '/api/asistencia',
      '/api/estadisticas',
      '/api/turnos/catalog',
      '/api/excepciones',
      '/api/sync'
    ]
  });
});

// 6. Manejador centralizado de errores seguro
app.use(errorHandler);

// Iniciar servidor y carga inicial
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Servidor Backend iniciado en http://0.0.0.0:${PORT} (${process.platform})`);
  try {
    await loadData();
    
    if (AUTO_SYNC_SEC > 0) {
      console.log(`🔄 Auto-sincronización en segundo plano configurada cada ${AUTO_SYNC_SEC} segundos.`);
      setInterval(async () => {
        try {
          await runSyncScript();
        } catch (err) {
          console.error('⚠️ Error en auto-sincronización periódica:', err.message);
        }
      }, AUTO_SYNC_SEC * 1000);
    }
  } catch (err) {
    console.error('⚠️ Error al cargar datos iniciales:', err.message);
  }
});

// Manejo de apagado ordenado (ideal para Docker, systemd en Ubuntu, y reinicios)
process.on('SIGTERM', () => {
  console.log('🛑 Señal SIGTERM recibida: Cerrando servidor HTTP ordenadamente...');
  server.close(() => {
    console.log('Servidor finalizado.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Señal SIGINT recibida: Deteniendo servicio...');
  server.close(() => {
    process.exit(0);
  });
});

