import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';
import { loadData, runSyncScript } from './services/dataStore.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;
const AUTO_SYNC_SEC = parseInt(process.env.AUTO_SYNC_INTERVAL_SEC || '30', 10);

app.use(cors());
app.use(express.json());

// API routes
app.use('/api', apiRoutes);

// Root endpoint info
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    system: 'Control de Acceso Anviz CrossChex API',
    version: '1.0.0',
    endpoints: [
      '/api/stats',
      '/api/fichadas',
      '/api/empleados',
      '/api/departamentos',
      '/api/sync'
    ]
  });
});

// Boot server and load initial dataset
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Servidor Backend iniciado en http://0.0.0.0:${PORT} (accesible en red local)`);
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

