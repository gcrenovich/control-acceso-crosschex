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

let devicesMap = new Map();                // sensorid/ClientNumber -> { num, name, tipo: 'IN' | 'OUT' }
let checkinsByDate = new Map();            // 'YYYY-MM-DD' (calendario) -> Array of checkin objects
let checkinsByOperationalDate = new Map(); // 'YYYY-MM-DD' (jornada 6am a 6am) -> Array of checkin objects
let checkinsByUser = new Map();            // userid -> Array of checkin objects
let checkinsByUserAndOpDate = new Map();   // `${userid}_${fechaOperativa}` -> Array of checkin objects
let leaveClassesMap = new Map();   // Classid -> leaveClass Object
let userLeavesList = [];           // Array of user leave objects
let userLeavesByUser = new Map();  // userid -> Array of leave objects

let lastSyncTime = null;
let isSyncing = false;
let isLoaded = false;

// Función de corte de jornada: de 06:00:00 AM a 05:59:59 AM del día siguiente
export const getOperationalDate = (dateTimeStr) => {
  if (!dateTimeStr) return '';
  const timePart = dateTimeStr.length >= 19 ? dateTimeStr.substring(11, 19) : (dateTimeStr.substring(11) || '00:00:00');
  const datePart = dateTimeStr.substring(0, 10);

  // Todo registro entre las 00:00:00 y las 05:59:59 pertenece a la jornada laboral del día anterior (ej: turno 21 a 05hs)
  if (timePart < '06:00:00') {
    const d = new Date(datePart + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().substring(0, 10);
  }
  return datePart;
};

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

  // Load Leave Classes (LeaveClass)
  leaveClassesMap.clear();
  const leaveClassPath = path.join(DATA_DIR, 'leave_classes.json');
  if (fs.existsSync(leaveClassPath)) {
    try {
      const raw = fs.readFileSync(leaveClassPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(lc => {
            const classId = Number(lc.Classid);
            leaveClassesMap.set(classId, {
              classId,
              className: String(lc.Classname || `Clase #${classId}`).trim(),
              viewColor: Number(lc.ViewColor || 0),
              showAs: String(lc.Showas || '').trim(),
              units: Number(lc.Units || 0),
              isLeave: Boolean(lc.IsLeave)
            });
          });
        }
      }
    } catch (err) {
      console.error('⚠️ Error al parsear leave_classes.json:', err.message);
    }
  }

  // Load User Leaves (Exceptions & Permissions)
  userLeavesList = [];
  userLeavesByUser.clear();
  const userLeavesPath = path.join(DATA_DIR, 'user_leaves.json');
  if (fs.existsSync(userLeavesPath)) {
    try {
      const raw = fs.readFileSync(userLeavesPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(l => {
            const uid = Number(l.userid);
            const classId = Number(l.LeaveClassid);
            const uObj = usersMap.get(uid) || { legajo: String(uid), nombre: `Usuario #${uid}`, deptId: 0, departamento: 'Sin Depto' };
            const lcObj = leaveClassesMap.get(classId) || { className: `Clase #${classId}`, showAs: 'E', viewColor: 255 };

            const leaveObj = {
              lsh: Number(l.Lsh),
              userid: uid,
              legajo: uObj.legajo,
              empleado: uObj.nombre,
              deptId: uObj.deptId,
              departamento: uObj.departamento,
              classId,
              className: lcObj.className,
              showAs: lcObj.showAs,
              beginTime: String(l.BeginTime || '').substring(0, 19),
              endTime: String(l.EndTime || '').substring(0, 19),
              beginDate: String(l.BeginTime || '').substring(0, 10),
              endDate: String(l.EndTime || '').substring(0, 10),
              whys: String(l.Whys || '').trim()
            };

            userLeavesList.push(leaveObj);

            if (!userLeavesByUser.has(uid)) {
              userLeavesByUser.set(uid, []);
            }
            userLeavesByUser.get(uid).push(leaveObj);
          });
        }
      }
    } catch (err) {
      console.error('⚠️ Error al parsear user_leaves.json:', err.message);
    }
  }

  // Stream CSV Checkins & Build High-Performance Indices
  checkinList = [];
  checkinsByDate.clear();
  checkinsByUser.clear();

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

        const checkinItem = {
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
        };

        checkinList.push(checkinItem);

        // Date index
        let dateArr = checkinsByDate.get(checkinItem.fecha);
        if (!dateArr) {
          dateArr = [];
          checkinsByDate.set(checkinItem.fecha, dateArr);
        }
        dateArr.push(checkinItem);

        // User index
        let userArr = checkinsByUser.get(userid);
        if (!userArr) {
          userArr = [];
          checkinsByUser.set(userid, userArr);
        }
        userArr.push(checkinItem);
      }
    }
  }

  lastSyncTime = new Date().toISOString();
  isLoaded = true;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✅ Carga finalizada: ${checkinList.length.toLocaleString()} fichadas, ${usersMap.size} empleados, ${timetablesMap.size} horarios y ${userLeavesList.length} excepciones cargadas en ${elapsed}s.`);
};

export const runSyncScript = () => {
  return new Promise((resolve, reject) => {
    if (isSyncing) return resolve({ message: 'Sincronización ya en curso' });
    isSyncing = true;

    // Compatibilidad multiplataforma: En Ubuntu/Linux la extracción de Access MDB no cuenta con ACE.OLEDB de Windows.
    if (process.platform !== 'win32') {
      isSyncing = false;
      console.log('ℹ️ Entorno Linux/Ubuntu detectado: la base Access MDB se sincroniza mediante ingesta de archivos. Recargando dataset en memoria...');
      return loadData()
        .then(() => resolve({ 
          success: true, 
          platform: process.platform, 
          message: 'Datos recargados exitosamente en Ubuntu.', 
          timestamp: lastSyncTime 
        }))
        .catch(reject);
    }

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

// Ingesta segura de archivos de datos (para transferencias desde Windows hacia servidor Ubuntu)
export const saveIngestedData = async (fileName, content) => {
  const allowedFiles = new Set([
    'departments.json',
    'users.json',
    'timetables.json',
    'schedules.json',
    'sch_times.json',
    'user_shifts.json',
    'user_temp_shifts.csv',
    'leave_classes.json',
    'user_leaves.json',
    'checkinout.csv'
  ]);

  const baseName = path.basename(fileName);
  if (!allowedFiles.has(baseName)) {
    throw new Error(`Archivo no permitido o inválido: ${baseName}`);
  }

  const targetPath = path.join(DATA_DIR, baseName);
  const tmpPath = `${targetPath}.tmp`;

  if (!fs.existsSync(DATA_DIR)) {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  }

  await fs.promises.writeFile(tmpPath, content, 'utf8');
  if (fs.existsSync(targetPath)) {
    await fs.promises.unlink(targetPath);
  }
  await fs.promises.rename(tmpPath, targetPath);
  return { success: true, file: baseName };
};

export const getStats = () => {
  const todayStr = new Date().toISOString().substring(0, 10);
  const todayArr = checkinsByDate.get(todayStr) || [];
  const todayCount = todayArr.length;
  const molineteCounts = {};
  const deptoCounts = {};

  for (let i = 0; i < checkinList.length; i++) {
    const item = checkinList[i];
    molineteCounts[item.molineteId] = (molineteCounts[item.molineteId] || 0) + 1;
    deptoCounts[item.departamento] = (deptoCounts[item.departamento] || 0) + 1;
  }

  return {
    totalCheckins: checkinList.length,
    todayCheckins: todayCount,
    totalUsers: usersMap.size,
    totalDepts: deptMap.size,
    totalExcepciones: userLeavesList.length,
    totalLeaveClasses: leaveClassesMap.size,
    lastSyncTime,
    isSyncing,
    isLoaded,
    molineteCounts,
    deptoCounts
  };
};

const getCheckinsForFilter = ({ fechaDesde, fechaHasta, userid }) => {
  if (userid && checkinsByUser.has(userid)) {
    let arr = checkinsByUser.get(userid) || [];
    if (fechaDesde) arr = arr.filter(c => c.fecha >= fechaDesde);
    if (fechaHasta) arr = arr.filter(c => c.fecha <= fechaHasta);
    return arr;
  }

  if (fechaDesde && fechaHasta) {
    const d1 = new Date(fechaDesde);
    const d2 = new Date(fechaHasta);
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
    if (diffDays >= 0 && diffDays <= 120) {
      const result = [];
      const curr = new Date(d1);
      while (curr <= d2) {
        const dStr = curr.toISOString().substring(0, 10);
        const dayArr = checkinsByDate.get(dStr);
        if (dayArr && dayArr.length > 0) {
          result.push(...dayArr);
        }
        curr.setDate(curr.getDate() + 1);
      }
      return result;
    }
  }

  if (fechaDesde && !fechaHasta) {
    const today = new Date().toISOString().substring(0, 10);
    return getCheckinsForFilter({ fechaDesde, fechaHasta: today, userid });
  }

  return checkinList;
};

export const getFichadas = ({ legajo, empleado, deptId, fechaDesde, fechaHasta, molineteId, page = 1, limit = 50 }) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;
  const filterMolinete = molineteId !== undefined && molineteId !== '' ? Number(molineteId) : null;

  let targetUserid = null;
  if (searchLegajo) {
    for (const [uid, u] of usersMap.entries()) {
      if (u.legajo.toLowerCase() === searchLegajo) {
        targetUserid = uid;
        break;
      }
    }
  }

  const baseCheckins = getCheckinsForFilter({ fechaDesde, fechaHasta, userid: targetUserid });
  let filtered = baseCheckins;

  if (searchLegajo || searchEmpleado || filterDept !== null || filterMolinete !== null || (baseCheckins === checkinList && (fechaDesde || fechaHasta))) {
    filtered = baseCheckins.filter(item => {
      if (searchLegajo && !item.legajo.toLowerCase().includes(searchLegajo)) return false;
      if (searchEmpleado && !item.empleado.toLowerCase().includes(searchEmpleado)) return false;
      if (filterDept !== null && item.deptId !== filterDept) return false;
      if (filterMolinete !== null && item.molineteId !== filterMolinete) return false;
      if (baseCheckins === checkinList) {
        if (fechaDesde && item.fecha < fechaDesde) return false;
        if (fechaHasta && item.fecha > fechaHasta) return false;
      }
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

  // Fallback to general user shift assignment if defined
  const userShifts = userShiftMap.get(userid);
  if (userShifts && userShifts.length > 0) {
    for (const us of userShifts) {
      if (us.beginDate && us.endDate) {
        if (dateStr >= us.beginDate && dateStr <= us.endDate) {
          const dateObj = new Date(dateStr + 'T00:00:00');
          const dayOfWeek = dateObj.getDay();
          const schTimeKey = `${us.schid}_${dayOfWeek}`;
          const tid = schTimeMap.get(schTimeKey);
          if (tid && timetablesMap.has(tid)) {
            return [timetablesMap.get(tid)];
          }
        }
      }
    }
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
  ordenFecha = 'ASC',
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

  // Fast filter checkins using date/user indices
  let targetUserid = null;
  if (searchLegajo) {
    for (const [uid, u] of usersMap.entries()) {
      if (u.legajo.toLowerCase() === searchLegajo) {
        targetUserid = uid;
        break;
      }
    }
  }

  const baseCheckins = getCheckinsForFilter({ fechaDesde, fechaHasta, userid: targetUserid });
  let filteredCheckins = baseCheckins;
  if (searchLegajo || searchEmpleado || filterDept !== null || (baseCheckins === checkinList && (fechaDesde || fechaHasta))) {
    filteredCheckins = baseCheckins.filter(item => {
      if (searchLegajo && !item.legajo.toLowerCase().includes(searchLegajo)) return false;
      if (searchEmpleado && !item.empleado.toLowerCase().includes(searchEmpleado)) return false;
      if (filterDept !== null && item.deptId !== filterDept) return false;
      if (baseCheckins === checkinList) {
        if (fechaDesde && item.fecha < fechaDesde) return false;
        if (fechaHasta && item.fecha > fechaHasta) return false;
      }
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

      // Check if employee has a registered exception/leave on this date
      const leave = getUserLeaveOnDate(userid, workDate);
      if (leave && (estadoAcceso === 'INCOMPLETE' || minutosTardanza === 0)) {
        estadoAcceso = 'EXCEPCION';
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
        duracionHoras: duracionHoras ? `${duracionHoras} hs` : (leave ? `Excepción (${leave.className})` : 'Sin Salida'),
        estado: estadoAcceso,
        excepcion: leave ? {
          classId: leave.classId,
          className: leave.className,
          showAs: leave.showAs,
          whys: leave.whys
        } : null,
        molineteEntrada: primera ? primera.molineteId : null,
        molineteSalida: ultima ? ultima.molineteId : null
      });
    });
  });

  // Sort by fecha according to ordenFecha ('ASC' default or 'DESC')
  if (ordenFecha && ordenFecha.toUpperCase() === 'DESC') {
    summary.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.legajo.localeCompare(b.legajo));
  } else {
    summary.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.legajo.localeCompare(b.legajo));
  }

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
  
  const dayCheckins = checkinsByDate.get(targetDate) || [];
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

    const userLeaves = userLeavesByUser.get(u.userid) || [];
    let licenciasDias = 0;
    const licenciasSet = new Set();
    const classCounts = {
      1: 0, // Enfermedad
      2: 0, // Accidente
      3: 0, // Con Aviso
      4: 0, // ERROR DE TARJETA
      5: 0, // cambio de turno
      6: 0, // Horas a Devolver
      7: 0, // Suspendido
      8: 0, // Sin Aviso
      9: 0, // Mision Gremial
      10: 0 // Horas compensadas
    };

    userLeaves.forEach(l => {
      if (l.endDate >= startStr && l.beginDate <= endStr) {
        licenciasSet.add(l.className);
        const b = l.beginDate < startStr ? startStr : l.beginDate;
        const e = l.endDate > endStr ? endStr : l.endDate;
        const days = Math.max(1, Math.round((new Date(e) - new Date(b)) / (1000 * 3600 * 24)) + 1);
        licenciasDias += days;
        if (classCounts[l.classId] !== undefined) {
          classCounts[l.classId] += days;
        }
      }
    });
    licenciasDias = Math.min(diffDays, licenciasDias);
    const ausenteInjustificadoDias = Math.max(0, ausenteDias - licenciasDias);

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
      licenciasDias,
      ausenteInjustificadoDias,
      licenciasDetalle: Array.from(licenciasSet).join(', '),
      tiempoExtraMin: 0,
      overtime1Min: 0,
      overtime2Min: 0,
      overtime3Min: 0,
      tiempoLibreHs: 0,
      sinEntradaVeces: uStat.sinEntradaVeces,
      sinSalidaVeces: uStat.sinSalidaVeces,
      tiempoTrabajadoHs: Number(uStat.totalTrabajadoHs.toFixed(2)),
      tiempoCumplidoHs: Number(uStat.totalTrabajadoHs.toFixed(2)),
      presentismoPct,
      enfermedad: classCounts[1] || 0,
      accidente: classCounts[2] || 0,
      conAviso: classCounts[3] || 0,
      errorTarjeta: classCounts[4] || 0,
      cambioTurno: classCounts[5] || 0,
      horasADevolver: classCounts[6] || 0,
      suspendido: classCounts[7] || 0,
      sinAviso: classCounts[8] || 0,
      misionGremial: classCounts[9] || 0,
      horasCompensadas: classCounts[10] || 0
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

export const getTurnosCatalog = () => {
  const timetables = Array.from(timetablesMap.values()).map(t => {
    let tipo = 'CORRIDO';
    if (t.isNightShift) {
      tipo = 'NOCTURNO';
    }
    const durationHs = t.longtime ? (t.longtime / 60).toFixed(1) : '8.0';

    return {
      timeid: t.timeid,
      name: t.name,
      intime: t.intime,
      outtime: t.outtime,
      bIntime: t.bIntime,
      eIntime: t.eIntime,
      bOuttime: t.bOuttime,
      eOuttime: t.eOuttime,
      latetime: t.latetime,
      leavetime: t.leavetime,
      longtime: t.longtime,
      durationHs,
      isNightShift: t.isNightShift,
      tipo
    };
  });

  const schedules = Array.from(schedulesMap.values()).map(s => ({
    schid: Number(s.Schid || s.schid || 0),
    schname: String(s.Schname || s.schname || 'Sin Nombre').trim(),
    cycles: Number(s.Cycles || s.cycles || 1),
    units: Number(s.Units || s.units || 1),
    isDefault: Boolean(s.IsDefault || s.isDefault)
  }));

  let corridoCount = 0;
  let nocturnoCount = 0;
  timetables.forEach(t => {
    if (t.tipo === 'NOCTURNO') nocturnoCount++;
    else corridoCount++;
  });

  return {
    success: true,
    totalTimetables: timetables.length,
    totalSchedules: schedules.length,
    stats: {
      corridoCount,
      nocturnoCount
    },
    timetables,
    schedules
  };
};

export const getEmpleadosTurnos = ({
  fecha,
  legajo,
  empleado,
  deptId,
  tipoHorario = 'TODOS',
  page = 1,
  limit = 50
}) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const targetDate = fecha || new Date().toISOString().substring(0, 10);

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;

  const nextDateObj = new Date(targetDate);
  nextDateObj.setDate(nextDateObj.getDate() + 1);
  const nextDateStr = nextDateObj.toISOString().substring(0, 10);

  const targetCheckinsList = checkinsByDate.get(targetDate) || [];
  const nextCheckinsList = checkinsByDate.get(nextDateStr) || [];

  const checkinsTargetMap = new Map();
  const checkinsNextMap = new Map();

  for (let i = 0; i < targetCheckinsList.length; i++) {
    const c = targetCheckinsList[i];
    if (!checkinsTargetMap.has(c.userid)) checkinsTargetMap.set(c.userid, []);
    checkinsTargetMap.get(c.userid).push(c);
  }

  for (let i = 0; i < nextCheckinsList.length; i++) {
    const c = nextCheckinsList[i];
    if (!checkinsNextMap.has(c.userid)) checkinsNextMap.set(c.userid, []);
    checkinsNextMap.get(c.userid).push(c);
  }

  const resultList = [];
  let countCorrido = 0;
  let countCortado = 0;
  let countNocturno = 0;
  let countAusentes = 0;
  let countExcepciones = 0;

  usersMap.forEach(u => {
    if (searchLegajo && !u.legajo.toLowerCase().includes(searchLegajo)) return;
    if (searchEmpleado && !u.nombre.toLowerCase().includes(searchEmpleado)) return;
    if (filterDept !== null && u.deptId !== filterDept) return;

    const assignedTTs = getAssignedTimetables(u.userid, targetDate);
    const dayCheckins = (checkinsTargetMap.get(u.userid) || []).sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));
    const nextCheckins = (checkinsNextMap.get(u.userid) || []).sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));

    let tipo = 'CORRIDO';
    let horarioTeoricoStr = '08:00 - 17:00';
    let horasTeoricas = 9.0;
    let primera = dayCheckins[0] || null;
    let ultima = dayCheckins.length > 1 ? dayCheckins[dayCheckins.length - 1] : null;
    let tramos = [];
    let duracionRealHs = null;
    let estado = 'PUNCTUAL';

    const nightTT = assignedTTs.find(t => t.isNightShift);
    const isDynamicNight = !assignedTTs.length && primera && parseTimeToMinutes(primera.hora) >= 19 * 60;

    if (nightTT || isDynamicNight) {
      tipo = 'NOCTURNO';
      const tt = nightTT || { name: 'Noche', intime: '21:00', outtime: '05:00', longtime: 480 };
      horarioTeoricoStr = `${tt.intime} - ${tt.outtime} (+1d)`;
      horasTeoricas = tt.longtime ? Number((tt.longtime / 60).toFixed(1)) : 8.0;

      const exitCheckin = nextCheckins.find(c => parseTimeToMinutes(c.hora) <= 11 * 60);
      if (exitCheckin) {
        ultima = exitCheckin;
      }
      if (primera && ultima) {
        const diffMs = new Date(ultima.fechaHora).getTime() - new Date(primera.fechaHora).getTime();
        duracionRealHs = (diffMs / (1000 * 3600)).toFixed(2);
        tramos.push({
          tramo: 'Turno Noche',
          entrada: primera.hora,
          salida: `${ultima.hora} (+1d)`,
          duracion: `${duracionRealHs} hs`
        });
      }
      countNocturno++;
    } else if (assignedTTs.length >= 2 || (assignedTTs.length === 0 && dayCheckins.length >= 4)) {
      tipo = 'CORTADO';
      if (assignedTTs.length >= 2) {
        const t1 = assignedTTs[0];
        const t2 = assignedTTs[1];
        horarioTeoricoStr = `${t1.intime}-${t1.outtime} / ${t2.intime}-${t2.outtime}`;
        horasTeoricas = Number(((t1.longtime + t2.longtime) / 60).toFixed(1));
      } else {
        horarioTeoricoStr = '07:00-12:00 / 14:00-18:00';
        horasTeoricas = 9.0;
      }

      if (dayCheckins.length >= 4) {
        const c1 = dayCheckins[0];
        const c2 = dayCheckins[1];
        const c3 = dayCheckins[2];
        const c4 = dayCheckins[dayCheckins.length - 1];

        const diff1Ms = new Date(c2.fechaHora).getTime() - new Date(c1.fechaHora).getTime();
        const diff2Ms = new Date(c4.fechaHora).getTime() - new Date(c3.fechaHora).getTime();
        const dur1 = (diff1Ms / (1000 * 3600)).toFixed(2);
        const dur2 = (diff2Ms / (1000 * 3600)).toFixed(2);
        duracionRealHs = (parseFloat(dur1) + parseFloat(dur2)).toFixed(2);
        primera = c1;
        ultima = c4;

        tramos.push(
          { tramo: 'Mañana (Tramo 1)', entrada: c1.hora, salida: c2.hora, duracion: `${dur1} hs` },
          { tramo: 'Tarde (Tramo 2)', entrada: c3.hora, salida: c4.hora, duracion: `${dur2} hs` }
        );
      } else if (dayCheckins.length >= 2) {
        primera = dayCheckins[0];
        ultima = dayCheckins[dayCheckins.length - 1];
        const diffMs = new Date(ultima.fechaHora).getTime() - new Date(primera.fechaHora).getTime();
        duracionRealHs = (diffMs / (1000 * 3600)).toFixed(2);
        tramos.push({
          tramo: 'Registro Parcial Cortado',
          entrada: primera.hora,
          salida: ultima.hora,
          duracion: `${duracionRealHs} hs`
        });
      }
      countCortado++;
    } else {
      tipo = 'CORRIDO';
      if (assignedTTs.length === 1) {
        const tt = assignedTTs[0];
        horarioTeoricoStr = `${tt.intime} - ${tt.outtime}`;
        horasTeoricas = tt.longtime ? Number((tt.longtime / 60).toFixed(1)) : 8.0;
      } else {
        horarioTeoricoStr = '08:00 - 17:00';
        horasTeoricas = 9.0;
      }

      if (primera && ultima && primera.fechaHora !== ultima.fechaHora) {
        const diffMs = new Date(ultima.fechaHora).getTime() - new Date(primera.fechaHora).getTime();
        duracionRealHs = (diffMs / (1000 * 3600)).toFixed(2);
        tramos.push({
          tramo: 'Jornada Corrida',
          entrada: primera.hora,
          salida: ultima.hora,
          duracion: `${duracionRealHs} hs`
        });
      }
      countCorrido++;
    }

    if (tipoHorario !== 'TODOS' && tipo !== tipoHorario) {
      return;
    }

    const leave = getUserLeaveOnDate(u.userid, targetDate);
    if (leave) {
      estado = 'EXCEPCION';
      countExcepciones++;
    } else if (dayCheckins.length === 0) {
      estado = 'ABSENT';
      countAusentes++;
    } else if (!ultima || (primera && ultima && primera.fechaHora === ultima.fechaHora)) {
      estado = 'INCOMPLETE';
    } else {
      estado = 'PUNCTUAL';
    }

    resultList.push({
      userid: u.userid,
      legajo: u.legajo,
      empleado: u.nombre,
      deptId: u.deptId,
      departamento: u.departamento,
      fecha: targetDate,
      tipoHorario: tipo,
      horarioTeorico: horarioTeoricoStr,
      horasTeoricas,
      fichadasCount: dayCheckins.length,
      entradaReal: primera ? primera.hora : '--:--:--',
      salidaReal: ultima ? ultima.hora : '--:--:--',
      duracionRealHs: duracionRealHs ? `${duracionRealHs} hs` : (leave ? `Excepción (${leave.className})` : (estado === 'ABSENT' ? 'Sin Registro' : 'Sin Salida')),
      estado,
      excepcion: leave ? {
        classId: leave.classId,
        className: leave.className,
        showAs: leave.showAs,
        whys: leave.whys,
        beginTime: leave.beginTime,
        endTime: leave.endTime
      } : null,
      tramos,
      fichadasRaw: dayCheckins.map(c => ({ hora: c.hora, molineteId: c.molineteId }))
    });
  });

  resultList.sort((a, b) => a.departamento.localeCompare(b.departamento) || a.legajo.localeCompare(b.legajo));

  const total = resultList.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (pageNum - 1) * pageSize;
  const data = resultList.slice(offset, offset + pageSize);
  const elapsedMs = Date.now() - startTime;

  return {
    success: true,
    fecha: targetDate,
    total,
    page: pageNum,
    limit: pageSize,
    totalPages,
    elapsedMs,
    summaryStats: {
      totalEmpleados: total,
      corridoCount: countCorrido,
      cortadoCount: countCortado,
      nocturnoCount: countNocturno,
      ausentesCount: countAusentes,
      excepcionesCount: countExcepciones
    },
    data
  };
};

export const getUserLeaveOnDate = (userid, dateStr) => {
  const leaves = userLeavesByUser.get(Number(userid));
  if (!leaves || leaves.length === 0) return null;
  return leaves.find(l => l.beginDate <= dateStr && l.endDate >= dateStr) || null;
};

export const getLeaveClasses = () => {
  return Array.from(leaveClassesMap.values());
};

export const getExcepcionesReport = ({
  legajo,
  empleado,
  deptId,
  fechaDesde,
  fechaHasta,
  classId,
  page = 1,
  limit = 50,
  exportAll = false
}) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;
  const filterClass = classId !== undefined && classId !== '' ? Number(classId) : null;

  let filtered = userLeavesList;

  if (searchLegajo || searchEmpleado || filterDept !== null || filterClass !== null || fechaDesde || fechaHasta) {
    filtered = userLeavesList.filter(l => {
      if (searchLegajo && !l.legajo.toLowerCase().includes(searchLegajo)) return false;
      if (searchEmpleado && !l.empleado.toLowerCase().includes(searchEmpleado)) return false;
      if (filterDept !== null && l.deptId !== filterDept) return false;
      if (filterClass !== null && l.classId !== filterClass) return false;
      if (fechaDesde && l.endDate < fechaDesde) return false;
      if (fechaHasta && l.beginDate > fechaHasta) return false;
      return true;
    });
  }

  filtered.sort((a, b) => b.beginTime.localeCompare(a.beginTime));

  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const data = exportAll ? filtered : filtered.slice((pageNum - 1) * pageSize, (pageNum - 1) * pageSize + pageSize);
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

