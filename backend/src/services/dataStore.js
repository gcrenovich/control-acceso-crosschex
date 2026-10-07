import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');

let usersMap = new Map();         // userid -> user Object
let deptMap = new Map();          // deptid -> dept Object
let checkinList = [];             // Array of sorted checkin objects
let timetablesMap = new Map();     // Timeid -> timetable Object
let userTempShiftMap = new Map();  // `${userid}_${WorkDate}` -> Array of Timeids
let userShiftMap = new Map();      // userid -> Array of { Schid, BeginDate, EndDate }
let schedulesMap = new Map();      // Schid -> schedule Object
let schTimeMap = new Map();        // `${Schid}_${BeginDay}` -> Timeid

let lastSyncTime = null;
let isSyncing = false;
let isLoaded = false;

const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const parts = String(timeStr).trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
};

export const loadData = async () => {
  console.log('🔄 Cargando datos en memoria...');
  const startTime = Date.now();

  const deptPath = path.join(DATA_DIR, 'departments.json');
  const userPath = path.join(DATA_DIR, 'users.json');
  const checkinPath = path.join(DATA_DIR, 'checkinout.csv');
  const timetablesPath = path.join(DATA_DIR, 'timetables.json');
  const userTempShiftPath = path.join(DATA_DIR, 'user_temp_shifts.csv');
  const userShiftPath = path.join(DATA_DIR, 'user_shifts.json');
  const schedulePath = path.join(DATA_DIR, 'schedules.json');
  const schTimePath = path.join(DATA_DIR, 'sch_times.json');

  if (!fs.existsSync(deptPath) || !fs.existsSync(userPath) || !fs.existsSync(checkinPath) || !fs.existsSync(timetablesPath)) {
    console.log('⚠️ Archivos de datos incompletos. Iniciando sincronización con Access MDB...');
    await runSyncScript();
  }

  // Load Departments
  deptMap.clear();
  if (fs.existsSync(deptPath)) {
    try {
      const raw = fs.readFileSync(deptPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const depts = JSON.parse(raw);
        if (Array.isArray(depts)) {
          depts.forEach(d => {
            const deptId = Number(d.Deptid);
            const supDeptId = Number(d.SupDeptid || 0);
            const deptName = String(d.DeptName || `Depto ${deptId}`).trim();
            deptMap.set(deptId, {
              deptId,
              deptName,
              supDeptId,
              categoria: classifyDepartment(deptName, supDeptId)
            });
          });
        }
      }
    } catch (err) {
      console.error('⚠️ Error al parsear departments.json:', err.message);
    }
  }

  // Load Users
  usersMap.clear();
  if (fs.existsSync(userPath)) {
    try {
      const raw = fs.readFileSync(userPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const users = JSON.parse(raw);
        if (Array.isArray(users)) {
          users.forEach(u => {
            const deptObj = deptMap.get(Number(u.Deptid));
            const deptName = deptObj ? deptObj.deptName : 'Sin Depto';
            usersMap.set(Number(u.userid), {
              userid: Number(u.userid),
              legajo: String(u.UserCode || '').trim(),
              nombre: String(u.Name || 'Sin Nombre').trim(),
              tarjeta: String(u.Cardnum || '').trim(),
              deptId: Number(u.Deptid),
              departamento: deptName
            });
          });
        }
      }
    } catch (err) {
      console.error('⚠️ Error al parsear users.json:', err.message);
    }
  }

  // Load TimeTable (Shift definitions)
  timetablesMap.clear();
  if (fs.existsSync(timetablesPath)) {
    try {
      const raw = fs.readFileSync(timetablesPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const ttList = JSON.parse(raw);
        if (Array.isArray(ttList)) {
          ttList.forEach(t => {
            const timeid = Number(t.Timeid);
            const intimeMin = parseTimeToMinutes(t.Intime);
            const outtimeMin = parseTimeToMinutes(t.Outtime);
            const bIntimeMin = parseTimeToMinutes(t.BIntime || t.Intime);
            const eIntimeMin = parseTimeToMinutes(t.EIntime || t.Intime);
            const bOuttimeMin = parseTimeToMinutes(t.BOuttime || t.Outtime);
            const eOuttimeMin = parseTimeToMinutes(t.EOuttime || t.Outtime);
            const isNightShift = outtimeMin < intimeMin;

            timetablesMap.set(timeid, {
              timeid,
              name: String(t.Timename || `Turno ${timeid}`).trim(),
              intime: String(t.Intime || '08:00').substring(0, 5),
              outtime: String(t.Outtime || '17:00').substring(0, 5),
              bIntime: String(t.BIntime || t.Intime || '00:00').substring(0, 5),
              eIntime: String(t.EIntime || t.Intime || '23:59').substring(0, 5),
              bOuttime: String(t.BOuttime || t.Outtime || '00:00').substring(0, 5),
              eOuttime: String(t.EOuttime || t.Outtime || '23:59').substring(0, 5),
              latetime: Number(t.Latetime || 10),
              leavetime: Number(t.Leavetime || 0),
              longtime: Number(t.Longtime || 480),
              intimeMin,
              outtimeMin,
              bIntimeMin,
              eIntimeMin,
              bOuttimeMin,
              eOuttimeMin,
              isNightShift
            });
          });
        }
      }
    } catch (err) {
      console.error('⚠️ Error al parsear timetables.json:', err.message);
    }
  }

  // Stream UserTempShift CSV (daily shift assignments)
  userTempShiftMap.clear();
  if (fs.existsSync(userTempShiftPath)) {
    const fileStream = fs.createReadStream(userTempShiftPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    let isHeader = true;
    for await (const line of rl) {
      if (isHeader) { isHeader = false; continue; }
      if (!line.trim()) continue;
      const parts = line.split(',');
      if (parts.length >= 3) {
        const uid = Number(parts[0]);
        const tid = Number(parts[1]);
        const wdate = parts[2].trim();
        const key = `${uid}_${wdate}`;
        if (!userTempShiftMap.has(key)) {
          userTempShiftMap.set(key, []);
        }
        userTempShiftMap.get(key).push(tid);
      }
    }
  }

  // Load Schedules & SchTimes & UserShifts
  schedulesMap.clear();
  if (fs.existsSync(schedulePath)) {
    try {
      const raw = fs.readFileSync(schedulePath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(s => schedulesMap.set(Number(s.Schid), s));
        }
      }
    } catch (err) {}
  }

  schTimeMap.clear();
  if (fs.existsSync(schTimePath)) {
    try {
      const raw = fs.readFileSync(schTimePath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(st => schTimeMap.set(`${st.Schid}_${st.BeginDay}`, Number(st.Timeid)));
        }
      }
    } catch (err) {}
  }

  userShiftMap.clear();
  if (fs.existsSync(userShiftPath)) {
    try {
      const raw = fs.readFileSync(userShiftPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(us => {
            const uid = Number(us.userid);
            if (!userShiftMap.has(uid)) userShiftMap.set(uid, []);
            userShiftMap.get(uid).push({
              schid: Number(us.Schid),
              beginDate: String(us.BeginDate || '').substring(0, 10),
              endDate: String(us.EndDate || '').substring(0, 10)
            });
          });
        }
      }
    } catch (err) {}
  }

  // Stream CSV Checkins
  checkinList = [];
  if (fs.existsSync(checkinPath)) {
    const fileStream = fs.createReadStream(checkinPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    for await (const line of rl) {
      if (isHeader) { isHeader = false; continue; }
      if (!line.trim()) continue;

      const parts = line.split(',');
      if (parts.length >= 5) {
        const logid = Number(parts[0]);
        const userid = Number(parts[1]);
        const checkTime = parts[2];
        const sensorid = Number(parts[3]);
        const temp = Number(parts[4]) || 0;

        const checkYear = parseInt(checkTime.substring(0, 4), 10);
        const currentYear = new Date().getFullYear();
        if (isNaN(checkYear) || checkYear < 2000 || checkYear > currentYear) {
          continue;
        }

        const user = usersMap.get(userid) || {
          legajo: 'Desconocido',
          nombre: `Usuario #${userid}`,
          departamento: 'Desconocido',
          deptId: 0
        };

        checkinList.push({
          logid,
          userid,
          legajo: user.legajo,
          empleado: user.nombre,
          deptId: user.deptId,
          departamento: user.departamento,
          fechaHora: checkTime,
          fecha: checkTime.substring(0, 10),
          hora: checkTime.substring(11, 19),
          molineteId: sensorid,
          temperatura: temp
        });
      }
    }
  }

  lastSyncTime = new Date().toISOString();
  isLoaded = true;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✅ Carga finalizada: ${checkinList.length.toLocaleString()} fichadas, ${usersMap.size} empleados y ${timetablesMap.size} horarios cargados en ${elapsed}s.`);
};

export const runSyncScript = () => {
  return new Promise((resolve, reject) => {
    if (isSyncing) return resolve({ message: 'Sincronización ya en curso' });
    isSyncing = true;

    const scriptPath = path.join(__dirname, '../scripts/export_data.ps1');
    const cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;

    console.log('🚀 Ejecutando script de sincronización con Access MDB...');
    exec(cmd, async (error, stdout, stderr) => {
      isSyncing = false;
      if (error) {
        console.error('❌ Error en script de sincronización:', stderr || error.message);
        return reject(error);
      }
      console.log('✅ Sincronización finalizada:', stdout.split('\n').pop());
      await loadData();
      resolve({ success: true, timestamp: lastSyncTime });
    });
  });
};

export const getStats = () => {
  const todayStr = new Date().toISOString().substring(0, 10);
  let todayCount = 0;
  const molineteCounts = {};
  const deptoCounts = {};

  for (let i = 0; i < checkinList.length; i++) {
    const item = checkinList[i];
    if (item.fecha === todayStr) {
      todayCount++;
    }
    molineteCounts[item.molineteId] = (molineteCounts[item.molineteId] || 0) + 1;
    deptoCounts[item.departamento] = (deptoCounts[item.departamento] || 0) + 1;
  }

  return {
    totalCheckins: checkinList.length,
    todayCheckins: todayCount,
    totalUsers: usersMap.size,
    totalDepts: deptMap.size,
    lastSyncTime,
    isSyncing,
    isLoaded,
    molineteCounts,
    deptoCounts
  };
};

export const getFichadas = ({ legajo, empleado, deptId, fechaDesde, fechaHasta, molineteId, page = 1, limit = 50 }) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;
  const filterMolinete = molineteId !== undefined && molineteId !== '' ? Number(molineteId) : null;

  let filtered = checkinList;

  if (searchLegajo || searchEmpleado || filterDept !== null || filterMolinete !== null || fechaDesde || fechaHasta) {
    filtered = checkinList.filter(item => {
      if (searchLegajo && !item.legajo.toLowerCase().includes(searchLegajo)) return false;
      if (searchEmpleado && !item.empleado.toLowerCase().includes(searchEmpleado)) return false;
      if (filterDept !== null && item.deptId !== filterDept) return false;
      if (filterMolinete !== null && item.molineteId !== filterMolinete) return false;
      if (fechaDesde && item.fecha < fechaDesde) return false;
      if (fechaHasta && item.fecha > fechaHasta) return false;
      return true;
    });
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (pageNum - 1) * pageSize;
  const data = filtered.slice(offset, offset + pageSize);
  const elapsedMs = Date.now() - startTime;

  return {
    total,
    page: pageNum,
    limit: pageSize,
    totalPages,
    elapsedMs,
    data
  };
};

export const getEmpleados = () => {
  return Array.from(usersMap.values());
};

export const getDepartamentos = () => {
  return Array.from(deptMap.values()).map(d => ({
    deptId: d.deptId,
    deptName: d.deptName,
    supDeptId: d.supDeptId,
    categoria: d.categoria
  })).sort((a, b) => a.deptName.localeCompare(b.deptName));
};

// Helper: Get assigned timetables for a user on a given date
const getAssignedTimetables = (userid, dateStr) => {
  const key = `${userid}_${dateStr}`;
  const timeids = userTempShiftMap.get(key);
  if (timeids && timeids.length > 0) {
    return timeids.map(id => timetablesMap.get(id)).filter(Boolean);
  }
  return [];
};

// Main Attendance Calculation Engine
export const getAsistenciaReport = ({
  legajo,
  empleado,
  deptId,
  fechaDesde,
  fechaHasta,
  estado,
  tipoHorario = 'TODOS',
  horarioEntrada = '08:00',
  horarioSalida = '17:00',
  toleranciaMin = 15,
  page = 1,
  limit = 50
}) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;
  const defaultTolerance = parseInt(toleranciaMin, 10) || 15;

  // Filter checkins
  let filteredCheckins = checkinList;
  if (searchLegajo || searchEmpleado || filterDept !== null) {
    filteredCheckins = checkinList.filter(item => {
      if (searchLegajo && !item.legajo.toLowerCase().includes(searchLegajo)) return false;
      if (searchEmpleado && !item.empleado.toLowerCase().includes(searchEmpleado)) return false;
      if (filterDept !== null && item.deptId !== filterDept) return false;
      return true;
    });
  }

  // Group checkins by user
  const userCheckinsMap = new Map();
  for (let i = 0; i < filteredCheckins.length; i++) {
    const c = filteredCheckins[i];
    if (!userCheckinsMap.has(c.userid)) {
      userCheckinsMap.set(c.userid, []);
    }
    userCheckinsMap.get(c.userid).push(c);
  }

  const summary = [];
  let totalPuntual = 0;
  let totalTardanzas = 0;
  let totalIncompletos = 0;
  let totalMinutosTardanza = 0;

  // Process each user's checkins
  userCheckinsMap.forEach((userCheckins, userid) => {
    const user = usersMap.get(userid) || {
      legajo: 'Desconocido',
      nombre: `Usuario #${userid}`,
      departamento: 'Desconocido',
      deptId: 0
    };

    // Sort checkins ascending
    userCheckins.sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));

    // Group checkins by calendar date initially
    const dateCheckinsMap = new Map();
    userCheckins.forEach(c => {
      if (!dateCheckinsMap.has(c.fecha)) {
        dateCheckinsMap.set(c.fecha, []);
      }
      dateCheckinsMap.get(c.fecha).push(c);
    });

    const dates = Array.from(dateCheckinsMap.keys()).sort();

    // Process each work date
    dates.forEach(workDate => {
      if (fechaDesde && workDate < fechaDesde) return;
      if (fechaHasta && workDate > fechaHasta) return;

      const dayCheckins = dateCheckinsMap.get(workDate) || [];
      const assignedTimetables = getAssignedTimetables(userid, workDate);

      let tipo = 'CORRIDO';
      let horarioAsignadoStr = `${horarioEntrada} - ${horarioSalida}`;
      let targetEntryMin = parseTimeToMinutes(horarioEntrada);
      let targetExitMin = parseTimeToMinutes(horarioSalida);
      let toleranceMin = defaultTolerance;

      let primera = dayCheckins[0];
      let ultima = dayCheckins.length > 1 ? dayCheckins[dayCheckins.length - 1] : null;
      let duracionHoras = null;
      let minutosTardanza = 0;
      let estadoAcceso = 'PUNCTUAL';

      // -------------------------------------------------------------
      // 1. NIGHT SHIFT (Turno Nocturno) - Overlap onto next morning
      // -------------------------------------------------------------
      const nightTT = assignedTimetables.find(t => t.isNightShift);
      const isDynamicNight = !assignedTimetables.length && primera && parseTimeToMinutes(primera.hora) >= 1900 / 100; // >= 19:00

      if (nightTT || isDynamicNight) {
        tipo = 'NOCTURNO';
        const tt = nightTT || {
          name: 'Noche',
          intime: '21:00',
          outtime: '05:00',
          intimeMin: 1260,
          outtimeMin: 300,
          latetime: defaultTolerance
        };

        horarioAsignadoStr = `${tt.intime} - ${tt.outtime} (+1d) [${tt.name}]`;
        targetEntryMin = tt.intimeMin;
        toleranceMin = tt.latetime || defaultTolerance;

        // Entry is late night on workDate
        const entryCheckin = dayCheckins.find(c => parseTimeToMinutes(c.hora) >= (targetEntryMin - 180));
        if (entryCheckin) primera = entryCheckin;

        // Exit is next morning (workDate + 1)
        const nextDateObj = new Date(workDate);
        nextDateObj.setDate(nextDateObj.getDate() + 1);
        const nextDateStr = nextDateObj.toISOString().substring(0, 10);
        const nextDayCheckins = dateCheckinsMap.get(nextDateStr) || [];
        
        // Find exit in early morning next day (e.g. before 11:00 AM)
        const exitCheckin = nextDayCheckins.find(c => parseTimeToMinutes(c.hora) <= 660); // <= 11:00
        if (exitCheckin) {
          ultima = exitCheckin;
        }
      }
      // -------------------------------------------------------------
      // 2. SPLIT SHIFT (Horario Cortado) - 2 shifts or 4 checkins
      // -------------------------------------------------------------
      else if (assignedTimetables.length >= 2 || (assignedTimetables.length === 0 && dayCheckins.length >= 4)) {
        tipo = 'CORTADO';
        if (assignedTimetables.length >= 2) {
          const t1 = assignedTimetables[0];
          const t2 = assignedTimetables[1];
          horarioAsignadoStr = `${t1.intime}-${t1.outtime} / ${t2.intime}-${t2.outtime} [${t1.name} / ${t2.name}]`;
          targetEntryMin = t1.intimeMin;
          toleranceMin = t1.latetime || defaultTolerance;
        } else {
          horarioAsignadoStr = `Cortado (08:00-12:00 / 14:00-18:00)`;
        }

        // Pair segment 1 and segment 2 if 4 clockings exist
        if (dayCheckins.length >= 4) {
          const c1 = dayCheckins[0];
          const c2 = dayCheckins[1];
          const c3 = dayCheckins[2];
          const c4 = dayCheckins[dayCheckins.length - 1];

          const diff1Ms = new Date(c2.fechaHora).getTime() - new Date(c1.fechaHora).getTime();
          const diff2Ms = new Date(c4.fechaHora).getTime() - new Date(c3.fechaHora).getTime();
          const totalHrs = (diff1Ms + diff2Ms) / (1000 * 3600);
          duracionHoras = totalHrs.toFixed(2);
          primera = c1;
          ultima = c4;
        }
      }
      // -------------------------------------------------------------
      // 3. CONTINUOUS SHIFT (Horario Corrido)
      // -------------------------------------------------------------
      else if (assignedTimetables.length === 1) {
        const tt = assignedTimetables[0];
        tipo = 'CORRIDO';
        horarioAsignadoStr = `${tt.intime} - ${tt.outtime} [${tt.name}]`;
        targetEntryMin = tt.intimeMin;
        targetExitMin = tt.outtimeMin;
        toleranceMin = tt.latetime || defaultTolerance;
      }

      // Filter by tipoHorario if requested
      if (tipoHorario && tipoHorario !== 'TODOS' && tipo !== tipoHorario) {
        return;
      }

      // Compute tardiness
      const entMin = parseTimeToMinutes(primera ? primera.hora : '00:00');
      if (entMin > (targetEntryMin + toleranceMin)) {
        minutosTardanza = entMin - targetEntryMin;
        estadoAcceso = 'LATE';
        totalTardanzas++;
        totalMinutosTardanza += minutosTardanza;
      } else {
        totalPuntual++;
      }

      // Check incomplete
      if (!ultima || (ultima.fechaHora === primera.fechaHora)) {
        if (estadoAcceso !== 'LATE') estadoAcceso = 'INCOMPLETE';
        totalIncompletos++;
      }

      // Filter by status if requested
      if (estado && estado !== '' && estadoAcceso !== estado) {
        return;
      }

      // Duration calculation if not already computed for split shift
      if (!duracionHoras && primera && ultima && ultima.fechaHora !== primera.fechaHora) {
        const diffMs = new Date(ultima.fechaHora).getTime() - new Date(primera.fechaHora).getTime();
        duracionHoras = (diffMs / (1000 * 3600)).toFixed(2);
      }

      summary.push({
        userid,
        legajo: user.legajo,
        empleado: user.nombre,
        deptId: user.deptId,
        departamento: user.departamento,
        fecha: workDate,
        tipoHorario: tipo,
        horarioAsignado: horarioAsignadoStr,
        entradaReal: primera ? primera.hora : '--:--:--',
        salidaReal: ultima ? ultima.hora : '--:--:--',
        totalFichadas: dayCheckins.length,
        minutosTardanza,
        duracionHoras: duracionHoras ? `${duracionHoras} hs` : 'Sin Salida',
        estado: estadoAcceso,
        molineteEntrada: primera ? primera.molineteId : null,
        molineteSalida: ultima ? ultima.molineteId : null
      });
    });
  });

  // Sort by fecha desc, legajo asc
  summary.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.legajo.localeCompare(b.legajo));

  const total = summary.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (pageNum - 1) * pageSize;
  const data = summary.slice(offset, offset + pageSize);
  const elapsedMs = Date.now() - startTime;

  return {
    total,
    page: pageNum,
    limit: pageSize,
    totalPages,
    elapsedMs,
    stats: {
      totalRegistros: total,
      totalPuntual,
      totalTardanzas,
      totalIncompletos,
      promedioTardanzaMin: totalTardanzas > 0 ? (totalMinutosTardanza / totalTardanzas).toFixed(1) : 0
    },
    data
  };
};

export const classifyDepartment = (name, supDeptId = 0) => {
  if (supDeptId === 2) return 'Permanente';
  if (supDeptId === 5) return 'Eventual';
  if (supDeptId === 4) return 'Transitorio';
  if (!name) return 'Transitorio';
  const trimmed = name.trim();
  if (trimmed.startsWith('P_') || trimmed === 'Permanente') return 'Permanente';
  if (trimmed.startsWith('E_') || trimmed.toLowerCase().includes('eventual')) return 'Eventual';
  return 'Transitorio';
};

export const getCensoAsistencia = ({ fecha }) => {
  const targetDate = fecha || new Date().toISOString().substring(0, 10);
  
  const dayCheckins = checkinList.filter(item => item.fecha === targetDate);
  const presentUserIds = new Set(dayCheckins.map(item => item.userid));

  const resumen = {
    Permanente: { total: 0, ingresaron: 0, faltan: 0, porcentaje: 0 },
    Eventual: { total: 0, ingresaron: 0, faltan: 0, porcentaje: 0 },
    Transitorio: { total: 0, ingresaron: 0, faltan: 0, porcentaje: 0 },
    General: { total: 0, ingresaron: 0, faltan: 0, porcentaje: 0 }
  };

  const deptoStatsMap = new Map();
  deptMap.forEach((deptObj, deptId) => {
    deptoStatsMap.set(deptId, {
      deptId,
      deptName: deptObj.deptName,
      supDeptId: deptObj.supDeptId,
      categoria: deptObj.categoria || classifyDepartment(deptObj.deptName, deptObj.supDeptId),
      total: 0,
      ingresaron: 0,
      faltan: 0,
      porcentaje: 0
    });
  });

  usersMap.forEach(u => {
    const cat = classifyDepartment(u.departamento);
    const isPresent = presentUserIds.has(u.userid);

    resumen[cat].total++;
    resumen.General.total++;
    if (isPresent) {
      resumen[cat].ingresaron++;
      resumen.General.ingresaron++;
    } else {
      resumen[cat].faltan++;
      resumen.General.faltan++;
    }

    const dStat = deptoStatsMap.get(u.deptId);
    if (dStat) {
      dStat.total++;
      if (isPresent) dStat.ingresaron++;
      else dStat.faltan++;
    }
  });

  Object.keys(resumen).forEach(k => {
    resumen[k].porcentaje = resumen[k].total > 0 
      ? Number(((resumen[k].ingresaron / resumen[k].total) * 100).toFixed(1)) 
      : 0;
  });

  const containerNames = ['ingenio rio grande', 'eventual', 'eventuales', 'transitorio', 'transitorios', 'permanente', 'permanentes'];
  const containerIds = new Set([1, 2, 4, 5]);

  const isContainerDept = (d) => {
    if (containerIds.has(Number(d.deptId))) return true;
    const nameLower = (d.deptName || '').trim().toLowerCase();
    return containerNames.includes(nameLower);
  };

  const censoDepartamentos = Array.from(deptoStatsMap.values())
    .map(d => ({
      ...d,
      porcentaje: d.total > 0 ? Number(((d.ingresaron / d.total) * 100).toFixed(1)) : 0
    }))
    .filter(d => d.total > 0 && !isContainerDept(d))
    .sort((a, b) => b.total - a.total);

  return {
    fecha: targetDate,
    resumen,
    censoDepartamentos
  };
};

export const getEstadisticasReport = ({
  fechaDesde,
  fechaHasta,
  deptId,
  legajo,
  empleado,
  tipoHorario = 'TODOS',
  horarioEntrada = '08:00',
  horarioSalida = '17:00',
  toleranciaMin = 15,
  page = 1,
  limit = 50,
  exportAll = false
}) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const todayStr = new Date().toISOString().substring(0, 10);
  const startStr = fechaDesde || todayStr.substring(0, 7) + '-01';
  const endStr = fechaHasta || todayStr;

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);
  const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)) + 1);

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;

  const asistenciaRes = getAsistenciaReport({
    legajo,
    empleado,
    deptId,
    fechaDesde: startStr,
    fechaHasta: endStr,
    tipoHorario,
    horarioEntrada,
    horarioSalida,
    toleranciaMin,
    page: 1,
    limit: 100000
  });

  const userStatsMap = new Map();

  asistenciaRes.data.forEach(item => {
    if (!userStatsMap.has(item.userid)) {
      userStatsMap.set(item.userid, {
        userid: item.userid,
        legajo: item.legajo,
        nombre: item.empleado,
        departamento: item.departamento,
        deptId: item.deptId,
        trabajadosDias: 0,
        llegadasTardeMin: 0,
        salidasTempranoMin: 0,
        totalTrabajadoHs: 0,
        sinEntradaVeces: 0,
        sinSalidaVeces: 0,
        tiposHorarioSet: new Set()
      });
    }

    const uStat = userStatsMap.get(item.userid);
    uStat.trabajadosDias++;
    uStat.llegadasTardeMin += item.minutosTardanza;
    if (item.duracionHoras && item.duracionHoras.includes('hs')) {
      uStat.totalTrabajadoHs += parseFloat(item.duracionHoras) || 0;
    }
    if (item.estado === 'INCOMPLETE') {
      uStat.sinSalidaVeces++;
    }
    uStat.tiposHorarioSet.add(item.tipoHorario);
  });

  const statsList = [];

  usersMap.forEach(u => {
    if (searchLegajo && !u.legajo.toLowerCase().includes(searchLegajo)) return;
    if (searchEmpleado && !u.nombre.toLowerCase().includes(searchEmpleado)) return;
    if (filterDept !== null && u.deptId !== filterDept) return;

    const uStat = userStatsMap.get(u.userid) || {
      trabajadosDias: 0,
      llegadasTardeMin: 0,
      salidasTempranoMin: 0,
      totalTrabajadoHs: 0,
      sinEntradaVeces: 0,
      sinSalidaVeces: 0,
      tiposHorarioSet: new Set()
    };

    const laboralesDias = diffDays;
    const trabajadosDias = uStat.trabajadosDias;
    const ausenteDias = Math.max(0, laboralesDias - trabajadosDias);

    const tipos = Array.from(uStat.tiposHorarioSet);
    const tipoHabitual = tipos.length > 0 ? tipos.join(', ') : 'CORRIDO';

    const presentismoPct = laboralesDias > 0 
      ? Number(((trabajadosDias / laboralesDias) * 100).toFixed(1))
      : 0;

    statsList.push({
      departamento: u.departamento,
      legajo: u.legajo,
      userid: u.userid,
      nombre: u.nombre,
      tipoHorarioHabitual: tipoHabitual,
      laboralesDias,
      trabajadosDias,
      llegadasTardeMin: uStat.llegadasTardeMin,
      salidasTempranoMin: uStat.salidasTempranoMin,
      ausenteDias,
      tiempoExtraMin: 0,
      overtime1Min: 0,
      overtime2Min: 0,
      overtime3Min: 0,
      tiempoLibreHs: 0,
      sinEntradaVeces: uStat.sinEntradaVeces,
      sinSalidaVeces: uStat.sinSalidaVeces,
      tiempoTrabajadoHs: Number(uStat.totalTrabajadoHs.toFixed(2)),
      tiempoCumplidoHs: Number(uStat.totalTrabajadoHs.toFixed(2)),
      presentismoPct
    });
  });

  statsList.sort((a, b) => a.departamento.localeCompare(b.departamento) || a.legajo.localeCompare(b.legajo));

  const total = statsList.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (pageNum - 1) * pageSize;
  const data = exportAll ? statsList : statsList.slice(offset, offset + pageSize);
  const elapsedMs = Date.now() - startTime;

  let totalTrabajadosDiasGlobal = 0;
  let totalAusenteDiasGlobal = 0;
  let totalLlegadasTardeMinGlobal = 0;
  let totalTiempoTrabajadoHsGlobal = 0;
  let sumPresentismo = 0;

  statsList.forEach(s => {
    totalTrabajadosDiasGlobal += s.trabajadosDias;
    totalAusenteDiasGlobal += s.ausenteDias;
    totalLlegadasTardeMinGlobal += s.llegadasTardeMin;
    totalTiempoTrabajadoHsGlobal += s.tiempoTrabajadoHs;
    sumPresentismo += s.presentismoPct;
  });

  return {
    total,
    page: pageNum,
    limit: pageSize,
    totalPages,
    elapsedMs,
    fechaDesde: startStr,
    fechaHasta: endStr,
    summaryStats: {
      totalEmpleados: total,
      promedioPresentismoPct: total > 0 ? Number((sumPresentismo / total).toFixed(1)) : 0,
      totalLlegadasTardeMin: totalLlegadasTardeMinGlobal,
      totalHorasTrabajadas: Number(totalTiempoTrabajadoHsGlobal.toFixed(1)),
      totalDiasTrabajados: totalTrabajadosDiasGlobal,
      totalAusencias: totalAusenteDiasGlobal
    },
    data,
    allData: statsList
  };
};
