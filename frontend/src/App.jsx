import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { 
  ShieldCheck, 
  RefreshCw, 
  Users, 
  Building2, 
  Clock, 
  Search, 
  Calendar, 
  Filter, 
  Download, 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight,
  Activity,
  UserCheck,
  X,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  BarChart3,
  ListFilter,
  PieChart,
  TrendingUp,
  UserX
} from 'lucide-react';

const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const API_BASE = `http://${hostname}:3005/api`;

function DonutChart({ ingresaron = 0, faltan = 0, total = 0, title, subtitle, colorIngresaron = '#10b981', colorFaltan = 'rgba(244, 63, 94, 0.25)' }) {
  const calcTotal = total || (ingresaron + faltan);
  const pct = calcTotal > 0 ? ((ingresaron / calcTotal) * 100).toFixed(1) : '0.0';
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = calcTotal > 0 ? circumference - (ingresaron / calcTotal) * circumference : circumference;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
      <div style={{ position: 'relative', width: '120px', height: '120px' }}>
        <svg width="120" height="120" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={colorFaltan}
            strokeWidth="10"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={colorIngresaron}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>{pct}%</span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ingresaron</span>
        </div>
      </div>
      <div style={{ marginTop: '0.5rem', textAlign: 'center' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{title}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{subtitle}</div>
      </div>
    </div>
  );
}

export default function App() {
  // Tab State: 'censo', 'asistencia', or 'fichadas'
  const [activeTab, setActiveTab] = useState('censo');

  // Master Data & KPI Stats
  const [stats, setStats] = useState(null);
  const [departamentos, setDepartamentos] = useState([]);
  
  // Fichadas Raw State
  const [fichadas, setFichadas] = useState([]);
  const [totalFichadas, setTotalFichadas] = useState(0);
  const [totalPagesFichadas, setTotalPagesFichadas] = useState(1);
  const [elapsedMsFichadas, setElapsedMsFichadas] = useState(0);

  // Asistencia Report State
  const [asistenciaList, setAsistenciaList] = useState([]);
  const [asistenciaTotal, setAsistenciaTotal] = useState(0);
  const [asistenciaTotalPages, setAsistenciaTotalPages] = useState(1);
  const [asistenciaStats, setAsistenciaStats] = useState(null);
  const [elapsedMsAsistencia, setElapsedMsAsistencia] = useState(0);

  // Censo & Categorias State
  const [censoData, setCensoData] = useState(null);
  const [censoFilterCat, setCensoFilterCat] = useState('');
  const [censoSearch, setCensoSearch] = useState('');

  // Estadísticas Acumuladas State
  const [estadisticasData, setEstadisticasData] = useState(null);

  // Shared Filters
  const getTodayString = () => new Date().toISOString().substring(0, 10);
  const [legajo, setLegajo] = useState('');
  const [empleado, setEmpleado] = useState('');
  const [deptId, setDeptId] = useState('');
  const [fechaDesde, setFechaDesde] = useState(getTodayString());
  const [fechaHasta, setFechaHasta] = useState(getTodayString());
  const [molineteId, setMolineteId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Asistencia Config Filters
  const [horarioEntrada, setHorarioEntrada] = useState('08:00');
  const [horarioSalida, setHorarioSalida] = useState('17:00');
  const [toleranciaMin, setToleranciaMin] = useState(15);
  const [estadoFilter, setEstadoFilter] = useState('');
  const [tipoHorarioFilter, setTipoHorarioFilter] = useState('TODOS');

  // UI States
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);

  // Auto-Refresh Realtime States
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [autoRefreshIntervalSec, setAutoRefreshIntervalSec] = useState(30);

  // Fetch Master Stats & Depts
  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const data = await res.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (err) {
      console.error('Error al cargar stats:', err);
    }
  };

  const fetchDepartamentos = async () => {
    try {
      const res = await fetch(`${API_BASE}/departamentos`);
      const data = await res.json();
      if (data.success) {
        setDepartamentos(data.data);
      }
    } catch (err) {
      console.error('Error al cargar departamentos:', err);
    }
  };

  // Fetch Raw Fichadas
  const fetchFichadas = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (legajo) queryParams.append('legajo', legajo);
      if (empleado) queryParams.append('empleado', empleado);
      if (deptId) queryParams.append('deptId', deptId);
      if (fechaDesde) queryParams.append('fechaDesde', fechaDesde);
      if (fechaHasta) queryParams.append('fechaHasta', fechaHasta);
      if (molineteId) queryParams.append('molineteId', molineteId);
      queryParams.append('page', page);
      queryParams.append('limit', limit);

      const res = await fetch(`${API_BASE}/fichadas?${queryParams.toString()}`);
      const data = await res.json();

      if (data.success) {
        setFichadas(data.data);
        setTotalFichadas(data.total);
        setTotalPagesFichadas(data.totalPages);
        setElapsedMsFichadas(data.elapsedMs);
      }
    } catch (err) {
      console.error('Error al cargar fichadas:', err);
    } finally {
      setLoading(false);
    }
  }, [legajo, empleado, deptId, fechaDesde, fechaHasta, molineteId, page, limit]);

  // Fetch Asistencia Report
  const fetchAsistencia = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (legajo) queryParams.append('legajo', legajo);
      if (empleado) queryParams.append('empleado', empleado);
      if (deptId) queryParams.append('deptId', deptId);
      if (fechaDesde) queryParams.append('fechaDesde', fechaDesde);
      if (fechaHasta) queryParams.append('fechaHasta', fechaHasta);
      if (estadoFilter) queryParams.append('estado', estadoFilter);
      if (tipoHorarioFilter && tipoHorarioFilter !== 'TODOS') queryParams.append('tipoHorario', tipoHorarioFilter);
      if (horarioEntrada) queryParams.append('horarioEntrada', horarioEntrada);
      if (horarioSalida) queryParams.append('horarioSalida', horarioSalida);
      if (toleranciaMin) queryParams.append('toleranciaMin', toleranciaMin);
      queryParams.append('page', page);
      queryParams.append('limit', limit);

      const res = await fetch(`${API_BASE}/asistencia?${queryParams.toString()}`);
      const data = await res.json();

      if (data.success) {
        setAsistenciaList(data.data);
        setAsistenciaTotal(data.total);
        setAsistenciaTotalPages(data.totalPages);
        setAsistenciaStats(data.stats);
        setElapsedMsAsistencia(data.elapsedMs);
      }
    } catch (err) {
      console.error('Error al cargar reporte de asistencia:', err);
    } finally {
      setLoading(false);
    }
  }, [legajo, empleado, deptId, fechaDesde, fechaHasta, estadoFilter, tipoHorarioFilter, horarioEntrada, horarioSalida, toleranciaMin, page, limit]);

  // Fetch Censo & Categorias
  const fetchCenso = useCallback(async () => {
    setLoading(true);
    try {
      const targetFecha = fechaDesde || getTodayString();
      const res = await fetch(`${API_BASE}/censo?fecha=${targetFecha}`);
      const data = await res.json();
      if (data.success) {
        setCensoData(data);
      }
    } catch (err) {
      console.error('Error al cargar censo:', err);
    } finally {
      setLoading(false);
    }
  }, [fechaDesde]);

  // Fetch Estadísticas Acumuladas
  const fetchEstadisticas = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (legajo) queryParams.append('legajo', legajo);
      if (empleado) queryParams.append('empleado', empleado);
      if (deptId) queryParams.append('deptId', deptId);
      if (fechaDesde) queryParams.append('fechaDesde', fechaDesde);
      if (fechaHasta) queryParams.append('fechaHasta', fechaHasta);
      if (tipoHorarioFilter && tipoHorarioFilter !== 'TODOS') queryParams.append('tipoHorario', tipoHorarioFilter);
      if (horarioEntrada) queryParams.append('horarioEntrada', horarioEntrada);
      if (horarioSalida) queryParams.append('horarioSalida', horarioSalida);
      if (toleranciaMin) queryParams.append('toleranciaMin', toleranciaMin);
      queryParams.append('page', page);
      queryParams.append('limit', limit);

      const res = await fetch(`${API_BASE}/estadisticas?${queryParams.toString()}`);
      const data = await res.json();
      if (data.success) {
        setEstadisticasData(data);
      }
    } catch (err) {
      console.error('Error al cargar estadísticas:', err);
    } finally {
      setLoading(false);
    }
  }, [legajo, empleado, deptId, fechaDesde, fechaHasta, horarioEntrada, horarioSalida, toleranciaMin, page, limit]);

  useEffect(() => {
    fetchStats();
    fetchDepartamentos();
  }, []);

  useEffect(() => {
    if (activeTab === 'asistencia') {
      fetchAsistencia();
    } else if (activeTab === 'fichadas') {
      fetchFichadas();
    } else if (activeTab === 'censo') {
      fetchCenso();
    } else if (activeTab === 'estadisticas') {
      fetchEstadisticas();
    }
  }, [activeTab, fetchAsistencia, fetchFichadas, fetchCenso, fetchEstadisticas]);

  // Periodic Auto-Refresh for Realtime Replica Updates
  useEffect(() => {
    if (!autoRefreshEnabled || autoRefreshIntervalSec <= 0) return;

    const timer = setInterval(() => {
      fetchStats();
      if (activeTab === 'asistencia') {
        fetchAsistencia();
      } else if (activeTab === 'fichadas') {
        fetchFichadas();
      } else if (activeTab === 'censo') {
        fetchCenso();
      } else if (activeTab === 'estadisticas') {
        fetchEstadisticas();
      }
    }, autoRefreshIntervalSec * 1000);

    return () => clearInterval(timer);
  }, [autoRefreshEnabled, autoRefreshIntervalSec, activeTab, fetchAsistencia, fetchFichadas, fetchCenso, fetchEstadisticas]);


  // Sync Trigger
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/sync`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchStats();
        if (activeTab === 'asistencia') await fetchAsistencia();
        else await fetchFichadas();
      }
    } catch (err) {
      console.error('Error al sincronizar:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setLegajo('');
    setEmpleado('');
    setDeptId('');
    setFechaDesde(getTodayString());
    setFechaHasta(getTodayString());
    setMolineteId('');
    setEstadoFilter('');
    setTipoHorarioFilter('TODOS');
    setHorarioEntrada('08:00');
    setHorarioSalida('17:00');
    setToleranciaMin(15);
    setPage(1);
  };

  // Export Excel for Asistencia
  const handleExportAsistenciaExcel = () => {
    if (!asistenciaList.length) return;
    const exportData = asistenciaList.map(row => ({
      'Legajo': row.legajo,
      'Empleado': row.empleado,
      'Departamento': row.departamento,
      'Fecha': row.fecha,
      'Horario Asignado': row.horarioAsignado,
      'Entrada Real': row.entradaReal,
      'Salida Real': row.salidaReal,
      'Horas Trabajadas': row.duracionHoras,
      'Minutos Tardanza': row.minutosTardanza > 0 ? `${row.minutosTardanza} min` : '0 min',
      'Estado': row.estado === 'PUNCTUAL' ? 'A Tiempo' : row.estado === 'LATE' ? 'Tardanza' : 'Fichada Incompleta',
      'Molinete Entrada': row.molineteEntrada ? `Molinete ${row.molineteEntrada}` : '-',
      'Molinete Salida': row.molineteSalida ? `Molinete ${row.molineteSalida}` : '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte_Asistencia');
    XLSX.writeFile(workbook, `Reporte_Asistencia_Tardanzas_${new Date().toISOString().substring(0, 10)}.xlsx`);
  };

  // Export Excel for Raw Fichadas
  const handleExportRawExcel = () => {
    if (!fichadas.length) return;
    const exportData = fichadas.map(row => ({
      'ID Fichada': row.logid,
      'Legajo': row.legajo,
      'Empleado': row.empleado,
      'Departamento': row.departamento,
      'Fecha Hora': row.fechaHora,
      'Molinete': `Molinete ${row.molineteId}`,
      'Temperatura': row.temperatura > 0 ? `${row.temperatura}°C` : 'Normal'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Fichadas_CrossChex');
    XLSX.writeFile(workbook, `Fichadas_CrossChex_${new Date().toISOString().substring(0, 10)}.xlsx`);
  };

  // Export Excel for Estadísticas
  const handleExportEstadisticasExcel = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (legajo) queryParams.append('legajo', legajo);
      if (empleado) queryParams.append('empleado', empleado);
      if (deptId) queryParams.append('deptId', deptId);
      if (fechaDesde) queryParams.append('fechaDesde', fechaDesde);
      if (fechaHasta) queryParams.append('fechaHasta', fechaHasta);
      if (horarioEntrada) queryParams.append('horarioEntrada', horarioEntrada);
      if (horarioSalida) queryParams.append('horarioSalida', horarioSalida);
      if (toleranciaMin) queryParams.append('toleranciaMin', toleranciaMin);
      queryParams.append('exportAll', 'true');

      const res = await fetch(`${API_BASE}/estadisticas?${queryParams.toString()}`);
      const data = await res.json();
      if (data.success && data.allData) {
        const exportRows = data.allData.map(row => ({
          'Departamento': row.departamento,
          'Usuario Nro.': row.legajo,
          'ID de usuario': row.userid,
          'Nombre': row.nombre,
          'Laborales [Días]': row.laboralesDias,
          'Trabajados [Días]': row.trabajadosDias,
          'Llegadas tarde [Minutos]': row.llegadasTardeMin,
          'Salidas temprano [Minutos]': row.salidasTempranoMin,
          'Ausente [Días]': row.ausenteDias,
          'Tiempo extra [Minutos]': row.tiempoExtraMin,
          'Overtime1 [Minutos]': row.overtime1Min,
          'Overtime2 [Minutos]': row.overtime2Min,
          'Overtime3 [Minutos]': row.overtime3Min,
          'Tiempo libre [Horas]': row.tiempoLibreHs,
          'Sin entrada [Veces]': row.sinEntradaVeces,
          'Sin salida [Veces]': row.sinSalidaVeces,
          'De viaje [Minutos]': row.deViajeMin,
          'Salidas de trabajo [Minutos]': row.salidasTrabajoMin,
          'Salidas [Horas]': row.salidasHs,
          'Tiempo trabajado [Horas]': row.tiempoTrabajadoHs,
          'Tiempo cumplido [Horas]': row.tiempoCumplidoHs,
          'Presentismo [%]': `${row.presentismoPct}%`,
          'Enfermedad': row.enfermedad,
          'Accidente': row.accidente,
          'Con Aviso': row.conAviso,
          'ERROR DE TARJETA': row.errorTarjeta,
          'cambio de turno': row.cambioTurno,
          'Horas a Devolver': row.horasADevolver,
          'Suspendido': row.suspendido,
          'Sin Aviso': row.sinAviso,
          'Mision Gremial': row.misionGremial,
          'Horas compensadas': row.horasCompensadas
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Estadisticas_Asistencia');
        XLSX.writeFile(workbook, `Estadisticas_Asistencia_${fechaDesde}_al_${fechaHasta}.xlsx`);
      }
    } catch (err) {
      console.error('Error al exportar estadísticas:', err);
    }
  };

  const molineteOptions = stats?.molineteCounts ? Object.keys(stats.molineteCounts).sort((a,b) => Number(a) - Number(b)) : [];

  return (
    <div className="app-container">
      {/* HEADER BAR */}
      <header className="glass-panel app-header">
        <div className="brand-section">
          <div className="brand-icon-wrapper">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 className="brand-title">Control de Acceso Anviz CrossChex</h1>
            <p className="brand-subtitle">Consolidado de Asistencia, Tardanzas y Fichadas de Molinetes</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="status-badge" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className={`status-dot ${autoRefreshEnabled ? 'active' : ''}`} style={{ background: autoRefreshEnabled ? '#10b981' : '#f59e0b', boxShadow: autoRefreshEnabled ? '0 0 10px #10b981' : 'none' }}></span>
            <span>Réplica MDB ({stats ? stats.totalCheckins.toLocaleString() : '1.03M'} Fichadas)</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.05)', padding: '0.35rem 0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.85rem' }}>
            <Clock size={15} style={{ color: autoRefreshEnabled ? '#10b981' : '#9ca3af' }} />
            <span style={{ color: 'var(--text-muted)' }}>Auto-Refresco:</span>
            <select
              value={autoRefreshEnabled ? autoRefreshIntervalSec : 0}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val === 0) {
                  setAutoRefreshEnabled(false);
                } else {
                  setAutoRefreshEnabled(true);
                  setAutoRefreshIntervalSec(val);
                }
              }}
              style={{
                background: 'rgba(15, 23, 42, 0.9)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                padding: '0.2rem 0.4rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value={10}>Cada 10 seg</option>
              <option value={30}>Cada 30 seg</option>
              <option value={60}>Cada 1 min</option>
              <option value={0}>Desactivado</option>
            </select>
          </div>

          <button 
            className="btn-primary" 
            onClick={handleSync} 
            disabled={syncing}
          >
            <RefreshCw size={18} className={syncing ? 'spinner' : ''} />
            <span>{syncing ? 'Sincronizando...' : 'Sincronizar MDB'}</span>
          </button>
        </div>
      </header>

      {/* VIEW TABS SELECTOR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="tab-group" style={{ flexWrap: 'wrap' }}>
          <button 
            className={`tab-btn ${activeTab === 'censo' ? 'active' : ''}`}
            onClick={() => { setActiveTab('censo'); }}
          >
            <PieChart size={18} /> Censo y Gráficas
          </button>

          <button 
            className={`tab-btn ${activeTab === 'estadisticas' ? 'active' : ''}`}
            onClick={() => { setActiveTab('estadisticas'); setPage(1); }}
          >
            <TrendingUp size={18} /> Estadísticas por Empleado
          </button>

          <button 
            className={`tab-btn ${activeTab === 'asistencia' ? 'active' : ''}`}
            onClick={() => { setActiveTab('asistencia'); setPage(1); }}
          >
            <BarChart3 size={18} /> Reporte de Asistencia
          </button>

          <button 
            className={`tab-btn ${activeTab === 'fichadas' ? 'active' : ''}`}
            onClick={() => { setActiveTab('fichadas'); setPage(1); }}
          >
            <ListFilter size={18} /> Registro Completo (1.03M)
          </button>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {activeTab === 'censo' 
            ? '🍩 Gráficas por Categoría (Permanentes, Eventuales, Transitorios) y Censo por Depto.' 
            : activeTab === 'estadisticas'
              ? '📈 Matriz de Estadísticas Acumuladas por Empleado (Días, Tardanzas, Ausencias, Horas)'
              : activeTab === 'asistencia' 
                ? '📊 Agrupación diaria por Legajo' 
                : '📋 Listado cronológico de accesos'}
        </div>
      </div>

      {/* CENSO Y GRÁFICAS VIEW */}
      {activeTab === 'censo' && censoData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
          {/* CATEGORIES DONUT CHARTS GRID */}
          <section className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {/* PERMANENTES (P_) */}
            <div className="glass-panel kpi-card" style={{ flexDirection: 'column', padding: '1.25rem', gap: '1rem', borderTop: '3px solid #6366f1' }}>
              <DonutChart 
                ingresaron={censoData.resumen.Permanente.ingresaron} 
                faltan={censoData.resumen.Permanente.faltan} 
                total={censoData.resumen.Permanente.total}
                title="Permanentes (P_)"
                subtitle={`Plantilla Total: ${censoData.resumen.Permanente.total} pers.`}
                colorIngresaron="#6366f1"
              />
              <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.82rem' }}>
                <span style={{ color: '#818cf8', fontWeight: 700 }}>🟢 Ingresaron: {censoData.resumen.Permanente.ingresaron}</span>
                <span style={{ color: '#f43f5e', fontWeight: 700 }}>🔴 Faltan: {censoData.resumen.Permanente.faltan}</span>
              </div>
            </div>

            {/* EVENTUALES (E_) */}
            <div className="glass-panel kpi-card" style={{ flexDirection: 'column', padding: '1.25rem', gap: '1rem', borderTop: '3px solid #f59e0b' }}>
              <DonutChart 
                ingresaron={censoData.resumen.Eventual.ingresaron} 
                faltan={censoData.resumen.Eventual.faltan} 
                total={censoData.resumen.Eventual.total}
                title="Eventuales (E_)"
                subtitle={`Plantilla Total: ${censoData.resumen.Eventual.total} pers.`}
                colorIngresaron="#f59e0b"
              />
              <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.82rem' }}>
                <span style={{ color: '#fbbf24', fontWeight: 700 }}>🟢 Ingresaron: {censoData.resumen.Eventual.ingresaron}</span>
                <span style={{ color: '#f43f5e', fontWeight: 700 }}>🔴 Faltan: {censoData.resumen.Eventual.faltan}</span>
              </div>
            </div>

            {/* TRANSITORIOS */}
            <div className="glass-panel kpi-card" style={{ flexDirection: 'column', padding: '1.25rem', gap: '1rem', borderTop: '3px solid #06b6d4' }}>
              <DonutChart 
                ingresaron={censoData.resumen.Transitorio.ingresaron} 
                faltan={censoData.resumen.Transitorio.faltan} 
                total={censoData.resumen.Transitorio.total}
                title="Transitorios"
                subtitle={`Plantilla Total: ${censoData.resumen.Transitorio.total} pers.`}
                colorIngresaron="#06b6d4"
              />
              <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.82rem' }}>
                <span style={{ color: '#22d3ee', fontWeight: 700 }}>🟢 Ingresaron: {censoData.resumen.Transitorio.ingresaron}</span>
                <span style={{ color: '#f43f5e', fontWeight: 700 }}>🔴 Faltan: {censoData.resumen.Transitorio.faltan}</span>
              </div>
            </div>

            {/* TOTAL GENERAL */}
            <div className="glass-panel kpi-card" style={{ flexDirection: 'column', padding: '1.25rem', gap: '1rem', borderTop: '3px solid #10b981' }}>
              <DonutChart 
                ingresaron={censoData.resumen.General.ingresaron} 
                faltan={censoData.resumen.General.faltan} 
                total={censoData.resumen.General.total}
                title="Total General"
                subtitle={`Plantilla Total: ${censoData.resumen.General.total} pers.`}
                colorIngresaron="#10b981"
              />
              <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.82rem' }}>
                <span style={{ color: '#34d399', fontWeight: 700 }}>🟢 Ingresaron: {censoData.resumen.General.ingresaron}</span>
                <span style={{ color: '#f43f5e', fontWeight: 700 }}>🔴 Faltan: {censoData.resumen.General.faltan}</span>
              </div>
            </div>
          </section>

          {/* CENSO POR DEPARTAMENTO PANEL */}
          <section className="glass-panel filter-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building2 size={20} style={{ color: 'var(--primary)' }} /> Censo y Asistencia por Departamento
              </h3>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Filtrar Tipo:</span>
                  <select
                    className="input-field"
                    value={censoFilterCat}
                    onChange={(e) => setCensoFilterCat(e.target.value)}
                    style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                  >
                    <option value="">Todas las Categorías</option>
                    <option value="Permanente">Permanentes (P_)</option>
                    <option value="Eventual">Eventuales (E_ / Eventual)</option>
                    <option value="Transitorio">Transitorios</option>
                  </select>
                </div>

                <div className="input-group" style={{ margin: 0 }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Buscar departamento..."
                    value={censoSearch}
                    onChange={(e) => setCensoSearch(e.target.value)}
                    style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                  />
                </div>
              </div>
            </div>

            <div className="table-responsive">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Departamento</th>
                    <th>Categoría</th>
                    <th style={{ textAlign: 'center' }}>Total Plantilla</th>
                    <th style={{ textAlign: 'center' }}>Ingresaron (Presentes)</th>
                    <th style={{ textAlign: 'center' }}>Faltan (Ausentes)</th>
                    <th>% Cumplimiento Asistencia</th>
                  </tr>
                </thead>
                <tbody>
                  {censoData.censoDepartamentos
                    .filter(d => {
                      if (censoFilterCat && d.categoria !== censoFilterCat) return false;
                      if (censoSearch && !d.deptName.toLowerCase().includes(censoSearch.toLowerCase())) return false;
                      return true;
                    })
                    .map(d => (
                      <tr key={d.deptId}>
                        <td style={{ fontWeight: 700, color: '#fff' }}>{d.deptName}</td>
                        <td>
                          <span className={
                            d.categoria === 'Permanente' ? 'badge-cat-permanente' :
                            d.categoria === 'Eventual' ? 'badge-cat-eventual' : 'badge-cat-transitorio'
                          }>
                            {d.categoria}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{d.total}</td>
                        <td style={{ textAlign: 'center', color: '#10b981', fontWeight: 800 }}>
                          {d.ingresaron}
                        </td>
                        <td style={{ textAlign: 'center', color: '#f43f5e', fontWeight: 800 }}>
                          {d.faltan}
                        </td>
                        <td style={{ width: '220px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, marginBottom: '2px' }}>
                            <span>{d.porcentaje}%</span>
                            <span style={{ color: d.porcentaje >= 70 ? '#10b981' : d.porcentaje >= 40 ? '#f59e0b' : '#f43f5e' }}>
                              {d.porcentaje >= 70 ? 'Excelente' : d.porcentaje >= 40 ? 'Medio' : 'Bajo'}
                            </span>
                          </div>
                          <div className="progress-bar-container">
                            <div 
                              className="progress-bar-fill" 
                              style={{ 
                                width: `${Math.min(100, d.porcentaje)}%`,
                                background: d.porcentaje >= 70 
                                  ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)' 
                                  : d.porcentaje >= 40 
                                    ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)' 
                                    : 'linear-gradient(90deg, #f43f5e 0%, #e11d48 100%)' 
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ESTADÍSTICAS ACUMULADAS VIEW */}
      {activeTab === 'estadisticas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
          {/* FILTER BAR */}
          <section className="glass-panel filter-panel">
            <div className="filter-row">
              <div className="input-group">
                <label className="input-label">Fecha Desde</label>
                <input 
                  type="date" 
                  className="input-field"
                  value={fechaDesde} 
                  onChange={(e) => { setFechaDesde(e.target.value); setPage(1); }}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Fecha Hasta</label>
                <input 
                  type="date" 
                  className="input-field"
                  value={fechaHasta} 
                  onChange={(e) => { setFechaHasta(e.target.value); setPage(1); }}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Departamento</label>
                <select 
                  className="input-field"
                  value={deptId} 
                  onChange={(e) => { setDeptId(e.target.value); setPage(1); }}
                >
                  <option value="">Todos los Departamentos</option>
                  {departamentos.map(d => (
                    <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Buscar Empleado / Legajo</label>
                <input 
                  type="text" 
                  className="input-field"
                  placeholder="Ej. GERMAN o 9851"
                  value={empleado || legajo} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setEmpleado(val);
                    setLegajo(val);
                    setPage(1);
                  }}
                />
              </div>

              <div className="filter-actions">
                <button className="btn-secondary" onClick={handleResetFilters}>
                  <RefreshCw size={16} /> Limpiar
                </button>
                <button className="btn-primary" onClick={handleExportEstadisticasExcel} style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
                  <FileSpreadsheet size={16} /> Exportar Excel
                </button>
              </div>
            </div>
          </section>

          {/* SUMMARY CARDS GRID */}
          {estadisticasData && estadisticasData.summaryStats && (
            <section className="kpi-grid">
              <div className="glass-panel kpi-card" style={{ '--card-accent': '#6366f1' }}>
                <div className="kpi-icon"><Users size={24} /></div>
                <div className="kpi-content">
                  <span className="kpi-value">{estadisticasData.summaryStats.totalEmpleados}</span>
                  <span className="kpi-label">Empleados Evaluados</span>
                </div>
              </div>

              <div className="glass-panel kpi-card" style={{ '--card-accent': '#10b981' }}>
                <div className="kpi-icon"><UserCheck size={24} /></div>
                <div className="kpi-content">
                  <span className="kpi-value" style={{ color: '#10b981' }}>{estadisticasData.summaryStats.promedioPresentismoPct}%</span>
                  <span className="kpi-label">Presentismo Promedio</span>
                </div>
              </div>

              <div className="glass-panel kpi-card" style={{ '--card-accent': '#f43f5e' }}>
                <div className="kpi-icon"><Clock3 size={24} /></div>
                <div className="kpi-content">
                  <span className="kpi-value" style={{ color: '#f43f5e' }}>{estadisticasData.summaryStats.totalLlegadasTardeMin} min</span>
                  <span className="kpi-label">Tardanzas Acumuladas</span>
                </div>
              </div>

              <div className="glass-panel kpi-card" style={{ '--card-accent': '#06b6d4' }}>
                <div className="kpi-icon"><Activity size={24} /></div>
                <div className="kpi-content">
                  <span className="kpi-value" style={{ color: '#06b6d4' }}>{estadisticasData.summaryStats.totalHorasTrabajadas} hs</span>
                  <span className="kpi-label">Tiempo Trabajado Total</span>
                </div>
              </div>
            </section>
          )}

          {/* FULL DATA TABLE */}
          <section className="glass-panel table-panel">
            <div className="table-header-info">
              <div className="table-title-group">
                <FileSpreadsheet size={20} style={{ color: 'var(--primary)' }} />
                <h3 className="table-title">Matriz Completa de Estadísticas por Empleado</h3>
              </div>
              <div className="bench-badge">
                {estadisticasData ? `${estadisticasData.total} Empleados (${estadisticasData.elapsedMs}ms)` : 'Cargando...'}
              </div>
            </div>

            <div className="table-responsive" style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {loading ? (
                <div className="loading-state">
                  <div className="spinner"></div>
                  <span>Calculando estadísticas acumuladas por empleado...</span>
                </div>
              ) : (
                estadisticasData && (
                  <table className="custom-table" style={{ minWidth: '2200px' }}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, zIndex: 15, background: '#0f172a' }}>Departamento</th>
                        <th style={{ position: 'sticky', left: '160px', zIndex: 15, background: '#0f172a' }}>Usuario Nro.</th>
                        <th>ID usuario</th>
                        <th>Nombre</th>
                        <th>Laborales [Días]</th>
                        <th>Trabajados [Días]</th>
                        <th>Llegadas tarde [Minutos]</th>
                        <th>Salidas temprano [Minutos]</th>
                        <th>Ausente [Días]</th>
                        <th>Tiempo extra [Minutos]</th>
                        <th>Overtime1 [Minutos]</th>
                        <th>Overtime2 [Minutos]</th>
                        <th>Overtime3 [Minutos]</th>
                        <th>Tiempo libre [Horas]</th>
                        <th>Sin entrada [Veces]</th>
                        <th>Sin salida [Veces]</th>
                        <th>De viaje [Minutos]</th>
                        <th>Salidas de trabajo [Minutos]</th>
                        <th>Salidas [Horas]</th>
                        <th>Tiempo trabajado [Horas]</th>
                        <th>Tiempo cumplido [Horas]</th>
                        <th>Presentismo</th>
                        <th>Enfermedad</th>
                        <th>Accidente</th>
                        <th>Con Aviso</th>
                        <th>ERROR DE TARJETA</th>
                        <th>cambio de turno</th>
                        <th>Horas a Devolver</th>
                        <th>Suspendido</th>
                        <th>Sin Aviso</th>
                        <th>Mision Gremial</th>
                        <th>Horas compensadas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estadisticasData.data.map((row) => (
                        <tr key={row.userid}>
                          <td style={{ position: 'sticky', left: 0, background: '#0f172a', fontWeight: 600 }}>
                            <span className="dept-tag">{row.departamento}</span>
                          </td>
                          <td style={{ position: 'sticky', left: '160px', background: '#0f172a' }}>
                            <span className="badge-legajo">{row.legajo}</span>
                          </td>
                          <td className="time-cell">{row.userid}</td>
                          <td style={{ fontWeight: 700, color: '#fff' }}>{row.nombre}</td>
                          <td style={{ textAlign: 'center' }}>{row.laboralesDias}</td>
                          <td style={{ textAlign: 'center', color: '#10b981', fontWeight: 700 }}>{row.trabajadosDias}</td>
                          <td style={{ textAlign: 'center', color: row.llegadasTardeMin > 0 ? '#f43f5e' : 'var(--text-muted)', fontWeight: row.llegadasTardeMin > 0 ? 700 : 400 }}>
                            {row.llegadasTardeMin > 0 ? `${row.llegadasTardeMin} min` : '0'}
                          </td>
                          <td style={{ textAlign: 'center', color: row.salidasTempranoMin > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                            {row.salidasTempranoMin > 0 ? `${row.salidasTempranoMin} min` : '0'}
                          </td>
                          <td style={{ textAlign: 'center', color: row.ausenteDias > 0 ? '#f43f5e' : 'var(--text-muted)', fontWeight: row.ausenteDias > 0 ? 700 : 400 }}>
                            {row.ausenteDias}
                          </td>
                          <td style={{ textAlign: 'center', color: '#06b6d4' }}>{row.tiempoExtraMin}</td>
                          <td style={{ textAlign: 'center' }}>{row.overtime1Min}</td>
                          <td style={{ textAlign: 'center' }}>{row.overtime2Min}</td>
                          <td style={{ textAlign: 'center' }}>{row.overtime3Min}</td>
                          <td style={{ textAlign: 'center' }}>{row.tiempoLibreHs}</td>
                          <td style={{ textAlign: 'center' }}>{row.sinEntradaVeces}</td>
                          <td style={{ textAlign: 'center', color: row.sinSalidaVeces > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{row.sinSalidaVeces}</td>
                          <td style={{ textAlign: 'center' }}>{row.deViajeMin}</td>
                          <td style={{ textAlign: 'center' }}>{row.salidasTrabajoMin}</td>
                          <td style={{ textAlign: 'center' }}>{row.salidasHs}</td>
                          <td className="time-cell" style={{ fontWeight: 700, color: '#fff' }}>{row.tiempoTrabajadoHs} hs</td>
                          <td className="time-cell">{row.tiempoCumplidoHs} hs</td>
                          <td>
                            <span className={row.presentismoPct >= 80 ? 'badge-status-punctual' : row.presentismoPct >= 50 ? 'badge-status-incomplete' : 'badge-status-late'}>
                              {row.presentismoPct}%
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>{row.enfermedad}</td>
                          <td style={{ textAlign: 'center' }}>{row.accidente}</td>
                          <td style={{ textAlign: 'center' }}>{row.conAviso}</td>
                          <td style={{ textAlign: 'center' }}>{row.errorTarjeta}</td>
                          <td style={{ textAlign: 'center' }}>{row.cambioTurno}</td>
                          <td style={{ textAlign: 'center' }}>{row.horasADevolver}</td>
                          <td style={{ textAlign: 'center' }}>{row.suspendido}</td>
                          <td style={{ textAlign: 'center' }}>{row.sinAviso}</td>
                          <td style={{ textAlign: 'center' }}>{row.misionGremial}</td>
                          <td style={{ textAlign: 'center' }}>{row.horasCompensadas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>

            {/* PAGINATION BAR FOR ESTADÍSTICAS */}
            {estadisticasData && (
              <div className="pagination-bar">
                <div className="pagination-info">
                  Mostrando página <strong style={{ color: '#fff' }}>{page}</strong> de <strong style={{ color: '#fff' }}>{estadisticasData.totalPages}</strong> ({estadisticasData.total} empleados)
                </div>

                <div className="pagination-controls">
                  <button 
                    className="btn-page" 
                    onClick={() => setPage(1)} 
                    disabled={page === 1}
                    title="Primera página"
                  >
                    <ChevronsLeft size={16} />
                  </button>
                  <button 
                    className="btn-page" 
                    onClick={() => setPage(p => Math.max(1, p - 1))} 
                    disabled={page === 1}
                    title="Página anterior"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <span style={{ fontSize: '0.85rem', padding: '0 8px', color: 'var(--text-muted)' }}>
                    Pág. {page} / {estadisticasData.totalPages}
                  </span>

                  <button 
                    className="btn-page" 
                    onClick={() => setPage(p => Math.min(estadisticasData.totalPages, p + 1))} 
                    disabled={page === estadisticasData.totalPages}
                    title="Página siguiente"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button 
                    className="btn-page" 
                    onClick={() => setPage(estadisticasData.totalPages)} 
                    disabled={page === estadisticasData.totalPages}
                    title="Última página"
                  >
                    <ChevronsRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* KPI METRICS GRID */}
      {activeTab === 'asistencia' ? (
        <section className="kpi-grid">
          <div className="glass-panel kpi-card" style={{ '--card-accent': '#6366f1' }}>
            <div className="kpi-icon">
              <Activity size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{asistenciaStats ? asistenciaStats.totalRegistros.toLocaleString() : '---'}</span>
              <span className="kpi-label">Días/Legajos Consolidados</span>
            </div>
          </div>

          <div className="glass-panel kpi-card" style={{ '--card-accent': '#10b981' }}>
            <div className="kpi-icon">
              <CheckCircle2 size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{asistenciaStats ? asistenciaStats.totalPuntual.toLocaleString() : '---'}</span>
              <span className="kpi-label">Ingresos A Tiempo</span>
            </div>
          </div>

          <div className="glass-panel kpi-card" style={{ '--card-accent': '#f43f5e' }}>
            <div className="kpi-icon">
              <Clock3 size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{asistenciaStats ? asistenciaStats.totalTardanzas.toLocaleString() : '---'}</span>
              <span className="kpi-label">
                Tardanzas {asistenciaStats?.promedioTardanzaMin ? `(Prom: ${asistenciaStats.promedioTardanzaMin}m)` : ''}
              </span>
            </div>
          </div>

          <div className="glass-panel kpi-card" style={{ '--card-accent': '#f59e0b' }}>
            <div className="kpi-icon">
              <AlertTriangle size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{asistenciaStats ? asistenciaStats.totalIncompletos.toLocaleString() : '---'}</span>
              <span className="kpi-label">Fichadas Incompletas (Sin Salida)</span>
            </div>
          </div>
        </section>
      ) : (
        <section className="kpi-grid">
          <div className="glass-panel kpi-card" style={{ '--card-accent': '#6366f1' }}>
            <div className="kpi-icon">
              <Activity size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{stats ? stats.totalCheckins.toLocaleString() : '1.035.996'}</span>
              <span className="kpi-label">Total Fichadas Registradas</span>
            </div>
          </div>

          <div className="glass-panel kpi-card" style={{ '--card-accent': '#10b981' }}>
            <div className="kpi-icon">
              <UserCheck size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{stats ? stats.totalUsers.toLocaleString() : '1.088'}</span>
              <span className="kpi-label">Empleados en Sistema</span>
            </div>
          </div>

          <div className="glass-panel kpi-card" style={{ '--card-accent': '#06b6d4' }}>
            <div className="kpi-icon">
              <Building2 size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{stats ? stats.totalDepts : '65'}</span>
              <span className="kpi-label">Departamentos Configurados</span>
            </div>
          </div>

          <div className="glass-panel kpi-card" style={{ '--card-accent': '#8b5cf6' }}>
            <div className="kpi-icon">
              <Clock size={26} />
            </div>
            <div className="kpi-content">
              <span className="kpi-value" style={{ fontSize: '1.1rem', fontFamily: 'var(--font-main)' }}>
                {stats?.lastSyncTime ? new Date(stats.lastSyncTime).toLocaleTimeString('es-AR') : 'Reciente'}
              </span>
              <span className="kpi-label">Última Réplica Local</span>
            </div>
          </div>
        </section>
      )}

      {/* FILTERS PANEL */}
      <section className="glass-panel filter-panel">
        <div className="filter-row">
          <div className="input-group">
            <label className="input-label">Buscar por Legajo</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Ej: 5830"
              value={legajo}
              onChange={(e) => { setLegajo(e.target.value); setPage(1); }}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Nombre del Empleado</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Ej: Sosa Diego"
              value={empleado}
              onChange={(e) => { setEmpleado(e.target.value); setPage(1); }}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Departamento</label>
            <select 
              className="input-field"
              value={deptId}
              onChange={(e) => { setDeptId(e.target.value); setPage(1); }}
            >
              <option value="">Todos los Departamentos</option>
              {departamentos.map(d => (
                <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label className="input-label">Fecha Desde</label>
            <input 
              type="date" 
              className="input-field"
              value={fechaDesde}
              onChange={(e) => { setFechaDesde(e.target.value); setPage(1); }}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Fecha Hasta</label>
            <input 
              type="date" 
              className="input-field"
              value={fechaHasta}
              onChange={(e) => { setFechaHasta(e.target.value); setPage(1); }}
            />
          </div>

          {activeTab === 'asistencia' ? (
            <>
              <div className="input-group">
                <label className="input-label">Horario Entrada Asignado</label>
                <input 
                  type="time" 
                  className="input-field"
                  value={horarioEntrada}
                  onChange={(e) => { setHorarioEntrada(e.target.value); setPage(1); }}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Tolerancia (Minutos)</label>
                <input 
                  type="number" 
                  className="input-field"
                  value={toleranciaMin}
                  min="0"
                  max="60"
                  onChange={(e) => { setToleranciaMin(e.target.value); setPage(1); }}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Tipo de Horario</label>
                <select 
                  className="input-field"
                  value={tipoHorarioFilter}
                  onChange={(e) => { setTipoHorarioFilter(e.target.value); setPage(1); }}
                >
                  <option value="TODOS">Todos los Horarios</option>
                  <option value="CORRIDO">⏱️ Horario Corrido</option>
                  <option value="CORTADO">✂️ Horario Cortado</option>
                  <option value="NOCTURNO">🌙 Turno Nocturno (+1d)</option>
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Estado de Asistencia</label>
                <select 
                  className="input-field"
                  value={estadoFilter}
                  onChange={(e) => { setEstadoFilter(e.target.value); setPage(1); }}
                >
                  <option value="">Todos los Estados</option>
                  <option value="PUNCTUAL">🟢 A Tiempo (Puntual)</option>
                  <option value="LATE">🔴 Tardanza</option>
                  <option value="INCOMPLETE">🟡 Fichada Incompleta</option>
                </select>
              </div>
            </>
          ) : (
            <div className="input-group">
              <label className="input-label">Molinete / Sensor ID</label>
              <select 
                className="input-field"
                value={molineteId}
                onChange={(e) => { setMolineteId(e.target.value); setPage(1); }}
              >
                <option value="">Todos los Molinetes ({molineteOptions.length})</option>
                {molineteOptions.map(m => (
                  <option key={m} value={m}>Molinete #{m} ({stats.molineteCounts[m].toLocaleString()} fichadas)</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="filter-actions">
          <button className="btn-secondary" onClick={() => { setFechaDesde(getTodayString()); setFechaHasta(getTodayString()); setPage(1); }} title="Filtrar marcaciones del día actual">
            <Calendar size={16} /> Ver Hoy
          </button>

          <button className="btn-secondary" onClick={() => { setFechaDesde(''); setFechaHasta(''); setPage(1); }} title="Ver todo el historial sin filtro de fecha">
            Histórico Completo
          </button>

          <button className="btn-secondary" onClick={handleResetFilters}>
            <Filter size={16} /> Restablecer Filtros
          </button>
          
          {activeTab === 'asistencia' ? (
            <button className="btn-primary" onClick={handleExportAsistenciaExcel} disabled={!asistenciaList.length}>
              <FileSpreadsheet size={16} /> Exportar Reporte Asistencia (.xlsx)
            </button>
          ) : (
            <button className="btn-primary" onClick={handleExportRawExcel} disabled={!fichadas.length}>
              <FileSpreadsheet size={16} /> Exportar Fichadas (.xlsx)
            </button>
          )}
        </div>
      </section>

      {/* DATA TABLE PANEL */}
      <section className="glass-panel table-panel">
        <div className="table-header-info">
          <div className="table-title-group">
            <h2 className="table-title">
              {activeTab === 'asistencia' ? 'Consolidado Diario de Asistencia y Horarios' : 'Fichadas de Molinete (Registros Crudos)'}
            </h2>
            <span className="bench-badge">
              ⚡ {(activeTab === 'asistencia' ? asistenciaTotal : totalFichadas).toLocaleString()} resultados ({activeTab === 'asistencia' ? elapsedMsAsistencia : elapsedMsFichadas}ms)
            </span>
          </div>

          <div className="input-group" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <span className="input-label" style={{ marginBottom: 0 }}>Filas por página:</span>
            <select 
              className="input-field" 
              value={limit} 
              onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
              style={{ padding: '6px 28px 6px 10px', fontSize: '0.85rem' }}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
        </div>

        <div className="table-responsive">
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Procesando y agrupando fichadas de la réplica CrossChex...</p>
            </div>
          ) : activeTab === 'asistencia' ? (
            asistenciaList.length === 0 ? (
              <div className="loading-state" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                <HelpCircle size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem', opacity: 0.6 }} />
                <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                  No se encontraron registros de asistencia para los filtros seleccionados.
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.2rem' }}>
                  {fechaDesde || fechaHasta 
                    ? `La réplica actual no contiene fichadas cargadas para la fecha ${fechaDesde || fechaHasta}.`
                    : 'Intenta ajustar los criterios de búsqueda por legajo o departamento.'}
                </p>
                {(fechaDesde || fechaHasta) && (
                  <button className="btn-secondary" onClick={() => { setFechaDesde(''); setFechaHasta(''); setPage(1); }} style={{ margin: '0 auto' }}>
                    <Calendar size={16} /> Ver Accesos Más Recientes
                  </button>
                )}
              </div>
            ) : (
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Legajo</th>
                    <th>Empleado</th>
                    <th>Departamento</th>
                    <th>Fecha</th>
                    <th>Tipo Horario</th>
                    <th>Horario Asignado</th>
                    <th>Entrada Real</th>
                    <th>Salida Real</th>
                    <th>Duración</th>
                    <th>Tardanza</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {asistenciaList.map((row, idx) => (
                    <tr key={`${row.userid}_${row.fecha}_${idx}`} onClick={() => setSelectedRecord(row)}>
                      <td>
                        <span className="badge-legajo">{row.legajo}</span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{row.empleado}</td>
                      <td>
                        <span className="dept-tag">{row.departamento}</span>
                      </td>
                      <td className="time-cell">{row.fecha}</td>
                      <td>
                        {row.tipoHorario === 'NOCTURNO' && (
                          <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(139, 92, 246, 0.2)', color: '#c084fc', border: '1px solid rgba(139, 92, 246, 0.4)' }}>
                            🌙 Nocturno
                          </span>
                        )}
                        {row.tipoHorario === 'CORTADO' && (
                          <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                            ✂️ Cortado
                          </span>
                        )}
                        {row.tipoHorario === 'CORRIDO' && (
                          <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)' }}>
                            ⏱️ Corrido
                          </span>
                        )}
                      </td>
                      <td className="time-cell" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{row.horarioAsignado}</td>
                      <td className="time-cell" style={{ color: '#10b981', fontWeight: 600 }}>{row.entradaReal}</td>
                      <td className="time-cell">{row.salidaReal}</td>
                      <td className="time-cell" style={{ color: '#06b6d4' }}>{row.duracionHoras}</td>
                      <td>
                        {row.minutosTardanza > 0 ? (
                          <span style={{ color: '#f43f5e', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                            +{row.minutosTardanza} min
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>0 min</span>
                        )}
                      </td>
                      <td>
                        {row.estado === 'PUNCTUAL' && (
                          <span className="badge-status-punctual">
                            <CheckCircle2 size={13} /> A Tiempo
                          </span>
                        )}
                        {row.estado === 'LATE' && (
                          <span className="badge-status-late">
                            <Clock3 size={13} /> Tardanza
                          </span>
                        )}
                        {row.estado === 'INCOMPLETE' && (
                          <span className="badge-status-incomplete">
                            <AlertTriangle size={13} /> Incompleta
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            fichadas.length === 0 ? (
              <div className="loading-state">
                <p>No se encontraron registros de fichadas con los filtros seleccionados.</p>
              </div>
            ) : (
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Legajo</th>
                    <th>Empleado</th>
                    <th>Departamento</th>
                    <th>Fecha y Hora</th>
                    <th>Molinete</th>
                    <th>Temperatura</th>
                  </tr>
                </thead>
                <tbody>
                  {fichadas.map((row) => (
                    <tr key={row.logid} onClick={() => setSelectedRecord(row)}>
                      <td>
                        <span className="badge-legajo">{row.legajo}</span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{row.empleado}</td>
                      <td>
                        <span className="dept-tag">{row.departamento}</span>
                      </td>
                      <td className="time-cell">{row.fechaHora}</td>
                      <td>
                        <span className="badge-molinete">
                          Molinete #{row.molineteId}
                        </span>
                      </td>
                      <td className="time-cell">
                        {row.temperatura > 0 ? `${row.temperatura}°C` : 'Normal'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>

        {/* PAGINATION BAR */}
        <div className="pagination-bar">
          <div className="pagination-info">
            Mostrando página <strong style={{ color: '#fff' }}>{page}</strong> de <strong style={{ color: '#fff' }}>{(activeTab === 'asistencia' ? asistenciaTotalPages : totalPagesFichadas).toLocaleString()}</strong> ({(activeTab === 'asistencia' ? asistenciaTotal : totalFichadas).toLocaleString()} total)
          </div>

          <div className="pagination-controls">
            <button 
              className="btn-page" 
              onClick={() => setPage(1)} 
              disabled={page === 1}
              title="Primera página"
            >
              <ChevronsLeft size={16} />
            </button>
            <button 
              className="btn-page" 
              onClick={() => setPage(p => Math.max(1, p - 1))} 
              disabled={page === 1}
              title="Página anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <span style={{ fontSize: '0.85rem', padding: '0 8px', color: 'var(--text-muted)' }}>
              Pág. {page} / {activeTab === 'asistencia' ? asistenciaTotalPages : totalPagesFichadas}
            </span>

            <button 
              className="btn-page" 
              onClick={() => setPage(p => Math.min(activeTab === 'asistencia' ? asistenciaTotalPages : totalPagesFichadas, p + 1))} 
              disabled={page === (activeTab === 'asistencia' ? asistenciaTotalPages : totalPagesFichadas)}
              title="Página siguiente"
            >
              <ChevronRight size={16} />
            </button>
            <button 
              className="btn-page" 
              onClick={() => setPage(activeTab === 'asistencia' ? asistenciaTotalPages : totalPagesFichadas)} 
              disabled={page === (activeTab === 'asistencia' ? asistenciaTotalPages : totalPagesFichadas)}
              title="Última página"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* DRAWER MODAL FOR RECORD DETAIL */}
      {selectedRecord && (
        <div className="modal-overlay" onClick={() => setSelectedRecord(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                  {activeTab === 'asistencia' ? 'Detalle de Asistencia Diaria' : 'Detalle de Marcación Cruda'}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {selectedRecord.fecha ? `Fecha: ${selectedRecord.fecha}` : `ID Registro #${selectedRecord.logid}`}
                </p>
              </div>
              <button className="close-btn" onClick={() => setSelectedRecord(null)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group">
                <span className="input-label">Empleado</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>{selectedRecord.empleado}</span>
              </div>

              <div className="input-group">
                <span className="input-label">Legajo</span>
                <span className="badge-legajo" style={{ alignSelf: 'flex-start' }}>{selectedRecord.legajo}</span>
              </div>

              <div className="input-group">
                <span className="input-label">Departamento</span>
                <span className="dept-tag" style={{ alignSelf: 'flex-start' }}>{selectedRecord.departamento}</span>
              </div>

              {activeTab === 'asistencia' ? (
                <>
                  <div className="input-group">
                    <span className="input-label">Horario Esperado</span>
                    <span className="time-cell" style={{ color: '#fff' }}>{selectedRecord.horarioAsignado}</span>
                  </div>

                  <div className="input-group">
                    <span className="input-label">Entrada Real (Primera Fichada)</span>
                    <span className="time-cell" style={{ color: '#10b981', fontWeight: 700 }}>
                      {selectedRecord.entradaReal} {selectedRecord.molineteEntrada ? `(Molinete #${selectedRecord.molineteEntrada})` : ''}
                    </span>
                  </div>

                  <div className="input-group">
                    <span className="input-label">Salida Real (Última Fichada)</span>
                    <span className="time-cell" style={{ color: '#06b6d4', fontWeight: 700 }}>
                      {selectedRecord.salidaReal} {selectedRecord.molineteSalida ? `(Molinete #${selectedRecord.molineteSalida})` : ''}
                    </span>
                  </div>

                  <div className="input-group">
                    <span className="input-label">Minutos de Tardanza</span>
                    <span style={{ color: selectedRecord.minutosTardanza > 0 ? '#f43f5e' : '#10b981', fontWeight: 700 }}>
                      {selectedRecord.minutosTardanza > 0 ? `+${selectedRecord.minutosTardanza} minutos de exceso` : 'Sin tardanza'}
                    </span>
                  </div>

                  <div className="input-group">
                    <span className="input-label">Total de Marcaciones en el Día</span>
                    <span style={{ color: '#fff', fontWeight: 600 }}>{selectedRecord.totalFichadas} marcaciones registradas</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="input-group">
                    <span className="input-label">Fecha y Hora de Fichada</span>
                    <span className="time-cell" style={{ fontSize: '1rem', color: '#fff' }}>{selectedRecord.fechaHora}</span>
                  </div>

                  <div className="input-group">
                    <span className="input-label">Molinete de Acceso</span>
                    <span className="badge-molinete" style={{ alignSelf: 'flex-start' }}>Molinete #{selectedRecord.molineteId}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
