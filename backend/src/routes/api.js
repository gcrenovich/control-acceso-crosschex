import express from 'express';
import { 
  getFichadas, 
  getStats, 
  getEmpleados, 
  getDepartamentos, 
  getAsistenciaReport, 
  runSyncScript, 
  getCensoAsistencia, 
  getEstadisticasReport,
  getTurnosCatalog,
  getEmpleadosTurnos,
  getExcepcionesReport,
  getLeaveClasses
} from '../services/dataStore.js';

const router = express.Router();

// GET /api/excepciones - Reporte de Permisos y Excepciones (UserLeave & LeaveClass)
router.get('/excepciones', (req, res) => {
  try {
    const { legajo, empleado, deptId, fechaDesde, fechaHasta, classId, page, limit, exportAll } = req.query;
    const result = getExcepcionesReport({
      legajo,
      empleado,
      deptId,
      fechaDesde,
      fechaHasta,
      classId,
      page,
      limit,
      exportAll: exportAll === 'true'
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/excepciones/classes - Catálogo de tipos de licencias/excepciones
router.get('/excepciones/classes', (req, res) => {
  try {
    const classes = getLeaveClasses();
    res.json({ success: true, count: classes.length, data: classes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stats - Métricas generales
router.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/censo - Censo de Asistencia y Categorías (Permanentes, Eventuales, Transitorios)
router.get('/censo', (req, res) => {
  try {
    const { fecha } = req.query;
    const result = getCensoAsistencia({ fecha });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/estadisticas - Estadísticas acumuladas y métricas detalladas por empleado
router.get('/estadisticas', (req, res) => {
  try {
    const { legajo, empleado, deptId, fechaDesde, fechaHasta, tipoHorario, horarioEntrada, horarioSalida, toleranciaMin, page, limit, exportAll } = req.query;
    const result = getEstadisticasReport({
      legajo,
      empleado,
      deptId,
      fechaDesde,
      fechaHasta,
      tipoHorario,
      horarioEntrada,
      horarioSalida,
      toleranciaMin,
      page,
      limit,
      exportAll: exportAll === 'true'
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/turnos/catalog - Catálogo de horarios/turnos y rotaciones configuradas
router.get('/turnos/catalog', (req, res) => {
  try {
    const result = getTurnosCatalog();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/turnos/empleados - Asignación y verificación de turnos por empleado
router.get('/turnos/empleados', (req, res) => {
  try {
    const { fecha, legajo, empleado, deptId, tipoHorario, page, limit } = req.query;
    const result = getEmpleadosTurnos({
      fecha,
      legajo,
      empleado,
      deptId,
      tipoHorario,
      page,
      limit
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/fichadas - Consulta paginada y filtrada de marcaciones
router.get('/fichadas', (req, res) => {
  try {
    const { legajo, empleado, deptId, fechaDesde, fechaHasta, molineteId, page, limit } = req.query;
    const result = getFichadas({
      legajo,
      empleado,
      deptId,
      fechaDesde,
      fechaHasta,
      molineteId,
      page,
      limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/asistencia - Reporte de Asistencia y Tardanzas
router.get('/asistencia', (req, res) => {
  try {
    const { legajo, empleado, deptId, fechaDesde, fechaHasta, estado, tipoHorario, horarioEntrada, horarioSalida, toleranciaMin, ordenFecha, page, limit } = req.query;
    const result = getAsistenciaReport({
      legajo,
      empleado,
      deptId,
      fechaDesde,
      fechaHasta,
      estado,
      tipoHorario,
      horarioEntrada,
      horarioSalida,
      toleranciaMin,
      ordenFecha,
      page,
      limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/empleados - Lista de empleados
router.get('/empleados', (req, res) => {
  try {
    const empleados = getEmpleados();
    res.json({ success: true, count: empleados.length, data: empleados });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/departamentos - Lista de departamentos
router.get('/departamentos', (req, res) => {
  try {
    const departamentos = getDepartamentos();
    res.json({ success: true, count: departamentos.length, data: departamentos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/sync - Disparar sincronización manual con réplica MDB
router.post('/sync', async (req, res) => {
  try {
    const result = await runSyncScript();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

