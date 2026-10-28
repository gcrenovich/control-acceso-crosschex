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
let holidaysMap = new Map();       // 'YYYY-MM-DD' -> holiday Object
let holidaysList = [];             // Array of holiday objects

let lastSyncTime = null;
let isSyncing = false;
let isLoaded = false;

// Helper para obtener fecha y hora local exacta del sistema (evita desfases UTC en Argentina)
export const getLocalNowStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
};

// Función de corte de jornada operativa inteligente:
// 1. Salidas (OUT) en la madrugada/mañana (hasta las 07:30:00) corresponden a la jornada nocturna iniciada el día anterior.
// 2. Ingresos (IN) matutinos (a partir de las 03:30:00) corresponden a la jornada de HOY (turnos 04:00, 05:00, 06:00, 07:00).
// 3. Ingresos muy tardíos de madrugada profunda (00:00 a 03:29:59) se asignan a la jornada del día anterior.
export const getOperationalDate = (dateTimeStr, tipoRegistro = 'IN') => {
  if (!dateTimeStr) return '';
  const timePart = dateTimeStr.length >= 19 ? dateTimeStr.substring(11, 19) : (dateTimeStr.substring(11) || '00:00:00');
  const datePart = dateTimeStr.substring(0, 10);

  const prevDate = () => {
    const d = new Date(datePart + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (tipoRegistro === 'OUT' && timePart < '07:30:00') {
    return prevDate();
  }

  if (tipoRegistro === 'IN' && timePart < '03:30:00') {
    return prevDate();
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
        const wdate = parts[2].trim().substring(0, 10);
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
          list.forEach(st => {
            const key = `${st.Schid}_${st.BeginDay}`;
            if (!schTimeMap.has(key)) schTimeMap.set(key, []);
            schTimeMap.get(key).push(Number(st.Timeid));
          });
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

  // Load Devices (FingerClient: entrada/salida)
  devicesMap.clear();
  const devicesPath = path.join(DATA_DIR, 'devices.json');
  if (fs.existsSync(devicesPath)) {
    try {
      const raw = fs.readFileSync(devicesPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const devs = JSON.parse(raw);
        if (Array.isArray(devs)) {
          devs.forEach(d => {
            const num = Number(d.ClientNumber);
            const cid = Number(d.Clientid);
            const name = String(d.ClientName || `Molinete ${num}`).trim();
            const recStatus = Number(d.RecStatus || 1);
            const isOut = recStatus === 2 || name.toLowerCase().includes('salida');
            const devObj = {
              clientNumber: num,
              clientId: cid,
              clientName: name,
              ipaddress: String(d.ipaddress || ''),
              recStatus,
              tipo: isOut ? 'OUT' : 'IN'
            };
            devicesMap.set(num, devObj);
            devicesMap.set(cid, devObj);
          });
        }
      }
    } catch (err) {
      console.error('⚠️ Error al parsear devices.json:', err.message);
    }
  }

  // Load Holidays (Feriados Nacionales y Personalizados)
  holidaysMap.clear();
  holidaysList = [];
  const holidaysPath = path.join(DATA_DIR, 'holidays.json');
  if (fs.existsSync(holidaysPath)) {
    try {
      const raw = fs.readFileSync(holidaysPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(h => {
            const fechaStr = String(h.fecha || '').substring(0, 10);
            if (fechaStr) {
              const hObj = {
                fecha: fechaStr,
                nombre: String(h.nombre || 'Feriado').trim(),
                tipo: String(h.tipo || 'nacional').trim()
              };
              holidaysMap.set(fechaStr, hObj);
              holidaysList.push(hObj);
            }
          });
        }
      }
    } catch (err) {
      console.error('⚠️ Error al parsear holidays.json:', err.message);
    }
  }

  // Integrar feriados de CrossChex si existen
  const cxHolPath = path.join(DATA_DIR, 'crosschex_holidays.json');
  if (fs.existsSync(cxHolPath)) {
    try {
      const raw = fs.readFileSync(cxHolPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(h => {
            const fechaStr = String(h.BDate || '').substring(0, 10);
            if (fechaStr && !holidaysMap.has(fechaStr)) {
              const hObj = {
                fecha: fechaStr,
                nombre: String(h.Name || 'Feriado CrossChex').trim(),
                tipo: 'crosschex'
              };
              holidaysMap.set(fechaStr, hObj);
              holidaysList.push(hObj);
            }
          });
        }
      }
    } catch (err) {}
  }

  // Stream CSV Checkins & Build High-Performance Indices
  checkinList = [];
  checkinsByDate.clear();
  checkinsByOperationalDate.clear();
  checkinsByUser.clear();
  checkinsByUserAndOpDate.clear();

  if (fs.existsSync(checkinPath)) {
    const fileStream = fs.createReadStream(checkinPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    for await (const line of rl) {
      if (isHeader) { isHeader = false; continue; }
      if (!line.trim()) continue;

      const parts = line.split(',');
      if (parts.length >= 5) {
        let logid, userid, checkTime, rawCheckType, sensorid, temp;

        if (parts.length >= 6) {
          // Formato nuevo con CheckType: Logid,userid,CheckTime,CheckType,Sensorid,temperature
          logid = Number(parts[0]);
          userid = Number(parts[1]);
          checkTime = parts[2];
          rawCheckType = parts[3] !== '' ? Number(parts[3]) : null;
          sensorid = Number(parts[4]);
          temp = Number(parts[5]) || 0;
        } else {
          // Formato anterior de 5 columnas: Logid,userid,CheckTime,Sensorid,temperature
          logid = Number(parts[0]);
          userid = Number(parts[1]);
          checkTime = parts[2];
          rawCheckType = null;
          sensorid = Number(parts[3]);
          temp = Number(parts[4]) || 0;
        }

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

        const devObj = devicesMap.get(sensorid);
        const molineteNombre = devObj ? devObj.clientName : `Molinete ${sensorid}`;

        // Determinación inequívoca de IN (Ingreso) vs OUT (Salida)
        let tipoRegistro = 'IN';
        if (rawCheckType === 0) {
          tipoRegistro = 'IN';
        } else if (rawCheckType === 1) {
          tipoRegistro = 'OUT';
        } else if (devObj) {
          tipoRegistro = devObj.tipo;
        } else if (sensorid === 3 || sensorid === 4) {
          tipoRegistro = 'OUT';
        } else {
          tipoRegistro = 'IN';
        }

        const tipoRegistroTexto = tipoRegistro === 'IN' ? 'Ingreso' : 'Salida';
        const fechaOperativa = getOperationalDate(checkTime, tipoRegistro);

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
          fechaOperativa,
          checkType: rawCheckType,
          tipoRegistro,
          tipoRegistroTexto,
          molineteId: sensorid,
          molineteNombre,
          temperatura: temp
        };

        checkinList.push(checkinItem);

        // Date index (calendario civil)
        let dateArr = checkinsByDate.get(checkinItem.fecha);
        if (!dateArr) {
          dateArr = [];
          checkinsByDate.set(checkinItem.fecha, dateArr);
        }
        dateArr.push(checkinItem);

        // Operational Date index (jornada 06:00 a 06:00)
        let opDateArr = checkinsByOperationalDate.get(fechaOperativa);
        if (!opDateArr) {
          opDateArr = [];
          checkinsByOperationalDate.set(fechaOperativa, opDateArr);
        }
        opDateArr.push(checkinItem);

        // User index
        let userArr = checkinsByUser.get(userid);
        if (!userArr) {
          userArr = [];
          checkinsByUser.set(userid, userArr);
        }
        userArr.push(checkinItem);

        // User and Operational Date index
        const userOpKey = `${userid}_${fechaOperativa}`;
        let userOpArr = checkinsByUserAndOpDate.get(userOpKey);
        if (!userOpArr) {
          userOpArr = [];
          checkinsByUserAndOpDate.set(userOpKey, userOpArr);
        }
        userOpArr.push(checkinItem);
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

    // Compatibilidad multiplataforma: En Ubuntu/Linux ejecutar sync_crosschex_linux.py
    if (process.platform !== 'win32') {
      const pythonScript = path.join(__dirname, '../scripts/sync_crosschex_linux.py');
      if (fs.existsSync(pythonScript)) {
        console.log('🚀 Ejecutando sincronizador directo Linux (10.0.0.89 -> 10.0.0.10)...');
        exec(`python3 "${pythonScript}"`, async (error, stdout, stderr) => {
          isSyncing = false;
          if (error) {
            console.error('❌ Error en script de sincronización Linux:', stderr || error.message);
            await loadData().catch(() => {});
            return reject(error);
          }
          console.log('✅ Sincronización Linux completada:', stdout.trim().split('\n').slice(-2).join(' '));
          await loadData();
          resolve({ success: true, timestamp: lastSyncTime, platform: 'linux' });
        });
        return;
      }

      isSyncing = false;
      console.log('ℹ️ Entorno Linux/Ubuntu detectado: recargando dataset en memoria...');
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
    'devices.json',
    'checkinout.csv',
    'holidays.json',
    'crosschex_holidays.json'
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
  const currentDtStr = getLocalNowStr();
  const currentOpDate = getOperationalDate(currentDtStr, 'IN');
  const todayOpArr = checkinsByOperationalDate.get(currentOpDate) || [];
  const todayCount = todayOpArr.length;

  // Determinar cuántos empleados están actualmente adentro vs salieron en la jornada operativa actual
  const userLastCheckin = new Map();
  for (let i = 0; i < todayOpArr.length; i++) {
    const c = todayOpArr[i];
    const prev = userLastCheckin.get(c.userid);
    if (!prev || c.fechaHora > prev.fechaHora) {
      userLastCheckin.set(c.userid, c);
    }
  }

  let personasAdentro = 0;
  let personasSalieron = 0;
  userLastCheckin.forEach(c => {
    if (c.tipoRegistro === 'IN') personasAdentro++;
    else personasSalieron++;
  });

  let totalIN = 0;
  let totalOUT = 0;
  const molineteCounts = {};
  const deptoCounts = {};

  for (let i = 0; i < checkinList.length; i++) {
    const item = checkinList[i];
    if (item.tipoRegistro === 'IN') totalIN++;
    else if (item.tipoRegistro === 'OUT') totalOUT++;

    const mKey = item.molineteNombre || `Molinete ${item.molineteId}`;
    molineteCounts[mKey] = (molineteCounts[mKey] || 0) + 1;
    deptoCounts[item.departamento] = (deptoCounts[item.departamento] || 0) + 1;
  }

  return {
    totalCheckins: checkinList.length,
    todayCheckins: todayCount,
    fechaOperativaActual: currentOpDate,
    personasAdentro,
    personasSalieron,
    totalIN,
    totalOUT,
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

const getCheckinsForFilter = ({ fechaDesde, fechaHasta, userid, useOperationalDate = true }) => {
  const indexMap = useOperationalDate ? checkinsByOperationalDate : checkinsByDate;
  const dateProp = useOperationalDate ? 'fechaOperativa' : 'fecha';

  if (userid && checkinsByUser.has(userid)) {
    let arr = checkinsByUser.get(userid) || [];
    if (fechaDesde) arr = arr.filter(c => c[dateProp] >= fechaDesde);
    if (fechaHasta) arr = arr.filter(c => c[dateProp] <= fechaHasta);
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
        const dayArr = indexMap.get(dStr);
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
    return getCheckinsForFilter({ fechaDesde, fechaHasta: today, userid, useOperationalDate });
  }

  return checkinList;
};

export const getFichadas = ({ legajo, empleado, deptId, fechaDesde, fechaHasta, molineteId, tipoRegistro, useOperationalDate = false, page = 1, limit = 50 }) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;
  const filterMolinete = molineteId !== undefined && molineteId !== '' ? Number(molineteId) : null;
  const filterTipo = tipoRegistro ? tipoRegistro.toString().toUpperCase().trim() : null;

  let targetUserid = null;
  if (searchLegajo) {
    for (const [uid, u] of usersMap.entries()) {
      if (u.legajo.toLowerCase() === searchLegajo) {
        targetUserid = uid;
        break;
      }
    }
  }

  const baseCheckins = getCheckinsForFilter({ fechaDesde, fechaHasta, userid: targetUserid, useOperationalDate });
  let filtered = baseCheckins;

  if (searchLegajo || searchEmpleado || filterDept !== null || filterMolinete !== null || filterTipo !== null || (baseCheckins === checkinList && (fechaDesde || fechaHasta))) {
    const dateProp = useOperationalDate ? 'fechaOperativa' : 'fecha';
    filtered = baseCheckins.filter(item => {
      if (searchLegajo && !item.legajo.toLowerCase().includes(searchLegajo)) return false;
      if (searchEmpleado && !item.empleado.toLowerCase().includes(searchEmpleado)) return false;
      if (filterDept !== null && item.deptId !== filterDept) return false;
      if (filterMolinete !== null && item.molineteId !== filterMolinete) return false;
      if (filterTipo && item.tipoRegistro !== filterTipo) return false;
      if (baseCheckins === checkinList) {
        if (fechaDesde && item[dateProp] < fechaDesde) return false;
        if (fechaHasta && item[dateProp] > fechaHasta) return false;
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
export const getAssignedTimetables = (userid, dateStr) => {
  const key = `${userid}_${dateStr}`;
  if (userTempShiftMap.has(key)) {
    const timeids = userTempShiftMap.get(key);
    if (timeids && timeids.length > 0) {
      const valid = timeids.map(id => timetablesMap.get(id)).filter(Boolean);
      if (valid.length > 0) return valid;
      // Si la excepción diaria es -1 (Descanso/Franco programado), no caer en el turno habitual
      if (timeids.includes(-1)) {
        return [{
          timeid: -1,
          name: 'Franco / Descanso (Excepción)',
          intime: '--:--',
          outtime: '--:--',
          isDayOff: true
        }];
      }
    }
  }

  // Fallback to general user shift assignment if defined
  const userShifts = userShiftMap.get(userid);
  if (userShifts && userShifts.length > 0) {
    // Filtrar turnos activos para la fecha y ordenar por beginDate descendente (el más reciente tiene prioridad)
    const activeShifts = userShifts
      .filter(us => us.beginDate && us.endDate && dateStr >= us.beginDate && dateStr <= us.endDate)
      .sort((a, b) => b.beginDate.localeCompare(a.beginDate));

    for (const us of activeShifts) {
      const schObj = schedulesMap.get(us.schid);
      const cycles = Number(schObj?.Cycles || schObj?.cycles || 1);
      const units = Number(schObj?.Units || schObj?.units || 1);
      const dateObj = new Date(dateStr + 'T00:00:00');
      const dayOfWeek = dateObj.getDay();

      let schTimeKey;
      if (cycles > 1 && us.beginDate) {
        // Cronograma rotativo (ej: 3 semanas = 21 días)
        const startObj = new Date(us.beginDate + 'T00:00:00');
        const diffDays = Math.round((dateObj - startObj) / (1000 * 3600 * 24));
        const totalDays = units === 0 ? cycles : cycles * 7;
        const cycleDay = ((diffDays % totalDays) + totalDays) % totalDays;
        schTimeKey = `${us.schid}_${cycleDay}`;
      } else {
        // Cronograma semanal regular (0: Dom, 1: Lun, ..., 6: Sab)
        schTimeKey = `${us.schid}_${dayOfWeek}`;
      }

      let tids = schTimeMap.get(schTimeKey);
      if (Array.isArray(tids) && tids.length > 0) {
        const found = tids.map(id => timetablesMap.get(id)).filter(Boolean);
        if (found.length > 0) return found;
      } else if (typeof tids === 'number' && timetablesMap.has(tids)) {
        return [timetablesMap.get(tids)];
      }
    }
  }

  return [];
};

// Motor unificado de cálculo de jornada y emparejamiento de fichadas IN/OUT
export const calculateUserDayAttendance = ({
  userid,
  user,
  workDate,
  checkins,
  assignedTimetables = [],
  defaultTolerance = 15,
  horarioEntrada = '08:00',
  horarioSalida = '17:00'
}) => {
  // Ordenar fichadas cronológicamente
  const sorted = [...checkins].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));

  // Desduplicar marcaciones consecutivas del mismo tipo en menos de 60 segundos (doble toque accidental en molinete)
  const clean = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (clean.length > 0) {
      const prev = clean[clean.length - 1];
      const diffSec = (new Date(cur.fechaHora).getTime() - new Date(prev.fechaHora).getTime()) / 1000;
      if (prev.tipoRegistro === cur.tipoRegistro && diffSec < 60) {
        continue;
      }
    }
    clean.push(cur);
  }

  // Emparejar tramos IN -> OUT y registrar tiempos de descanso intermedios
  const tramos = [];
  let currentIn = null;
  let totalTrabajadoMs = 0;
  let totalDescansoMs = 0;
  let prevOut = null;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c.tipoRegistro === 'IN') {
      if (currentIn) {
        // Marcación IN previa sin OUT intermedio (cierre como incompleto)
        tramos.push({
          numero: tramos.length + 1,
          entrada: currentIn.hora,
          salida: '--:--:--',
          entradaFechaHora: currentIn.fechaHora,
          salidaFechaHora: null,
          molineteEntrada: currentIn.molineteNombre,
          molineteSalida: null,
          duracionMin: 0,
          duracionHs: 0,
          descansoPosteriorMin: 0,
          descansoPosteriorHs: '0.00',
          estadoTramo: 'SIN_SALIDA'
        });
      }

      if (prevOut) {
        const breakMs = new Date(c.fechaHora).getTime() - new Date(prevOut.fechaHora).getTime();
        if (breakMs > 0) {
          totalDescansoMs += breakMs;
          if (tramos.length > 0) {
            tramos[tramos.length - 1].descansoPosteriorMin = Math.round(breakMs / 60000);
            tramos[tramos.length - 1].descansoPosteriorHs = (breakMs / (1000 * 3600)).toFixed(2);
          }
        }
        prevOut = null;
      }
      currentIn = c;
    } else if (c.tipoRegistro === 'OUT') {
      if (currentIn) {
        const diffMs = new Date(c.fechaHora).getTime() - new Date(currentIn.fechaHora).getTime();
        const durMin = Math.max(0, Math.round(diffMs / 60000));
        const durHs = diffMs / (1000 * 3600);
        totalTrabajadoMs += diffMs;

        tramos.push({
          numero: tramos.length + 1,
          entrada: currentIn.hora,
          salida: c.hora,
          entradaReal: currentIn.hora,
          salidaReal: c.hora,
          entradaFechaHora: currentIn.fechaHora,
          salidaFechaHora: c.fechaHora,
          molineteEntrada: currentIn.molineteNombre,
          molineteSalida: c.molineteNombre,
          duracionMin: durMin,
          duracionHs: Number(durHs.toFixed(2)),
          descansoPosteriorMin: 0,
          descansoPosteriorHs: '0.00',
          estadoTramo: 'COMPLETO'
        });
        prevOut = c;
        currentIn = null;
      } else {
        // OUT sin IN previo registrado
        tramos.push({
          numero: tramos.length + 1,
          entrada: '--:--:--',
          salida: c.hora,
          entradaReal: '--:--:--',
          salidaReal: c.hora,
          entradaFechaHora: null,
          salidaFechaHora: c.fechaHora,
          molineteEntrada: null,
          molineteSalida: c.molineteNombre,
          duracionMin: 0,
          duracionHs: 0,
          descansoPosteriorMin: 0,
          descansoPosteriorHs: '0.00',
          estadoTramo: 'SIN_ENTRADA'
        });
        prevOut = c;
      }
    }
  }

  if (currentIn) {
    tramos.push({
      numero: tramos.length + 1,
      entrada: currentIn.hora,
      salida: '--:--:--',
      entradaReal: currentIn.hora,
      salidaReal: '--:--:--',
      entradaFechaHora: currentIn.fechaHora,
      salidaFechaHora: null,
      molineteEntrada: currentIn.molineteNombre,
      molineteSalida: null,
      duracionMin: 0,
      duracionHs: 0,
      descansoPosteriorMin: 0,
      descansoPosteriorHs: '0.00',
      estadoTramo: 'SIN_SALIDA'
    });
  }

  // Fallback de contingencia: solo si p1 es IN y p2 es OUT (nunca emparejar al revés un OUT con un IN posterior)
  if (tramos.filter(t => t.estadoTramo === 'COMPLETO').length === 0 && clean.length >= 2) {
    const p1 = clean[0];
    const p2 = clean[clean.length - 1];
    if (p1.tipoRegistro !== 'OUT' && p2.tipoRegistro !== 'IN') {
      const diffMs = new Date(p2.fechaHora).getTime() - new Date(p1.fechaHora).getTime();
      if (diffMs > 5 * 60 * 1000) {
        const durMin = Math.round(diffMs / 60000);
        const durHs = diffMs / (1000 * 3600);
        totalTrabajadoMs = diffMs;
        tramos.length = 0;
        tramos.push({
          numero: 1,
          entrada: p1.hora,
          salida: p2.hora,
          entradaReal: p1.hora,
          salidaReal: p2.hora,
          entradaFechaHora: p1.fechaHora,
          salidaFechaHora: p2.fechaHora,
          molineteEntrada: p1.molineteNombre,
          molineteSalida: p2.molineteNombre,
          duracionMin: durMin,
          duracionHs: Number(durHs.toFixed(2)),
          descansoPosteriorMin: 0,
          descansoPosteriorHs: '0.00',
          estadoTramo: 'COMPLETO'
        });
      }
    }
  }

  // Determinar primer ingreso real y última salida real legítimos
  const primerIngresoItem = clean.find(c => c.tipoRegistro === 'IN') || null;
  const ultimaSalidaItem = [...clean].reverse().find(c => c.tipoRegistro === 'OUT') || null;

  const primerIngreso = primerIngresoItem ? primerIngresoItem.hora : '--:--:--';
  const ultimaSalida = ultimaSalidaItem ? ultimaSalidaItem.hora : '--:--:--';

  // Clasificación de Turno: NOCTURNO, CORTADO, CORRIDO
  let tipo = 'CORRIDO';
  let horarioAsignadoStr = `${horarioEntrada} - ${horarioSalida}`;
  let targetEntryMin = parseTimeToMinutes(horarioEntrada);
  let targetExitMin = parseTimeToMinutes(horarioSalida);
  let toleranceMin = defaultTolerance;

  const nightTT = assignedTimetables.find(t => t.isNightShift);
  const primerHoraMin = primerIngresoItem ? parseTimeToMinutes(primerIngresoItem.hora) : 0;
  // Detección nocturna: por asignación o por marcación real de noche (ingreso >= 19:00 o madrugada y salida en la mañana)
  const isActualNightPunches = primerIngresoItem && primerHoraMin >= 19 * 60 && ultimaSalidaItem && parseTimeToMinutes(ultimaSalidaItem.hora) < 12 * 60;
  const isDynamicNight = (!assignedTimetables.length || isActualNightPunches) && primerIngresoItem && (primerHoraMin >= 19 * 60 || primerHoraMin < 6 * 60);

  const workDateObj = new Date(workDate + 'T00:00:00');
  const dayOfWeek = workDateObj.getDay(); // 0: Dom, 1: Lun, 2: Mar, 3: Mie, 4: Jue, 5: Vie, 6: Sab

  let horasTeoricas = 8.0;

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
    targetExitMin = tt.outtimeMin;
    toleranceMin = tt.latetime || defaultTolerance;
    horasTeoricas = tt.longtime ? Number((tt.longtime / 60).toFixed(1)) : 8.0;
  } else if (assignedTimetables.length >= 2) {
    // Si tiene asignado horario cortado pero solo registró 1 tramo corrido de duración completa (>= 5.5 hs sin descanso intermedio)
    const tramosCompletos = tramos.filter(t => t.estadoTramo === 'COMPLETO');
    const hizoCorrido = tramosCompletos.length === 1 && totalDescansoMs < 20 * 60 * 1000 && tramosCompletos[0].duracionHs >= 5.5;

    if (hizoCorrido) {
      tipo = 'CORRIDO';
      const t1 = assignedTimetables[0];
      const tLast = assignedTimetables[assignedTimetables.length - 1];
      horarioAsignadoStr = `${t1.intime} - ${tLast.outtime} [Corrido / ${t1.name}]`;
      targetEntryMin = t1.intimeMin;
      targetExitMin = tLast.outtimeMin;
      toleranceMin = t1.latetime || defaultTolerance;
      horasTeoricas = Number((((t1.longtime || 240) + (tLast.longtime || 240)) / 60).toFixed(1));
    } else {
      tipo = 'CORTADO';
      const t1 = assignedTimetables[0];
      const t2 = assignedTimetables[1];
      horarioAsignadoStr = `${t1.intime}-${t1.outtime} / ${t2.intime}-${t2.outtime} [${t1.name} / ${t2.name}]`;
      targetEntryMin = t1.intimeMin;
      targetExitMin = t2.outtimeMin;
      toleranceMin = t1.latetime || defaultTolerance;
      horasTeoricas = Number((((t1.longtime || 240) + (t2.longtime || 240)) / 60).toFixed(1));
    }
  } else if (trramosCompletosCount(tramos) >= 2 || totalDescansoMs >= 20 * 60 * 1000) {
    tipo = 'CORTADO';
    // Detección dinámica inteligente según hora de ingreso real y día:
    if (primerHoraMin < 7 * 60 + 35) {
      targetEntryMin = 7 * 60;
      toleranceMin = 15;
      if (dayOfWeek === 5) {
        horarioAsignadoStr = 'Cortado (07:00-12:00 / 14:00-17:00) [Viernes]';
        targetExitMin = 17 * 60;
        horasTeoricas = 8.0;
      } else {
        horarioAsignadoStr = 'Cortado (07:00-12:00 / 14:00-18:00)';
        targetExitMin = 18 * 60;
        horasTeoricas = 9.0;
      }
    } else {
      targetEntryMin = 8 * 60;
      toleranceMin = 15;
      horarioAsignadoStr = 'Cortado (08:00-12:00 / 14:00-18:00)';
      targetExitMin = 18 * 60;
      horasTeoricas = 8.0;
    }
  } else if (assignedTimetables.length === 1) {
    const tt = assignedTimetables[0];
    if (tt.isDayOff) {
      tipo = 'FRANCO';
      horarioAsignadoStr = `[${tt.name}]`;
      targetEntryMin = 0;
      targetExitMin = 0;
      toleranceMin = 0;
      horasTeoricas = 0.0;
    } else {
      tipo = 'CORRIDO';
      horarioAsignadoStr = `${tt.intime} - ${tt.outtime} [${tt.name}]`;
      targetEntryMin = tt.intimeMin;
      targetExitMin = tt.outtimeMin;
      toleranceMin = tt.latetime || defaultTolerance;
      horasTeoricas = tt.longtime ? Number((tt.longtime / 60).toFixed(1)) : 8.0;
    }
  } else {
    // Sin asignación en tabla: evaluar jornada según marcaciones reales
    if (dayOfWeek === 6 && primerHoraMin >= 6 * 60 && primerHoraMin <= 10 * 60) {
      // Sábados mediodía (08:00 a 12:00)
      tipo = 'CORRIDO';
      horarioAsignadoStr = 'Mediodía Sábado (08:00 - 12:00)';
      targetEntryMin = 8 * 60;
      targetExitMin = 12 * 60;
      toleranceMin = 15;
      horasTeoricas = 4.0;
    } else if (primerHoraMin >= 4 * 60 && primerHoraMin < 6 * 60 + 15) {
      // Turno mañana corrida temprana (05:00 - 13:00 / 06:00 - 14:00)
      tipo = 'CORRIDO';
      if (primerHoraMin < 5 * 60 + 35) {
        horarioAsignadoStr = 'Mañana 1 (05:00 - 13:00)';
        targetEntryMin = 5 * 60;
        targetExitMin = 13 * 60;
      } else {
        horarioAsignadoStr = 'Mañana 3 (06:00 - 14:00)';
        targetEntryMin = 6 * 60;
        targetExitMin = 14 * 60;
      }
      toleranceMin = 10;
      horasTeoricas = 8.0;
    } else {
      tipo = 'CORRIDO';
      horarioAsignadoStr = `${horarioEntrada} - ${horarioSalida}`;
      targetEntryMin = parseTimeToMinutes(horarioEntrada);
      targetExitMin = parseTimeToMinutes(horarioSalida);
      toleranceMin = defaultTolerance;
      horasTeoricas = 8.0;
    }
  }

  // Cálculo de tardanzas y salidas temprano por tramo / turno
  let minutosTardanza = 0;
  let minutosSalidaTemprano = 0;
  let estadoAcceso = 'PUNCTUAL';

  if (assignedTimetables && assignedTimetables.length >= 2 && tramos.length >= 1) {
    // Horario cortado o rotativo con múltiples turnos por día
    for (let idx = 0; idx < assignedTimetables.length; idx++) {
      const tt = assignedTimetables[idx];
      const tr = tramos[idx];
      if (!tr) continue;

      const segIntimeMin = tt.intimeMin !== undefined ? tt.intimeMin : parseTimeToMinutes(tt.intime);
      const segOuttimeMin = tt.outtimeMin !== undefined ? tt.outtimeMin : parseTimeToMinutes(tt.outtime);
      const segTolMin = tt.latetime !== undefined ? tt.latetime : 0;

      // Tardanza del tramo (si supera la tolerancia, se computa la diferencia desde el horario nominal)
      if (tr.entradaReal && tr.entradaReal !== '--:--:--') {
        const trEntMin = parseTimeToMinutes(tr.entradaReal);
        if (trEntMin > segIntimeMin + segTolMin) {
          minutosTardanza += (trEntMin - segIntimeMin);
        }
      }

      // Salida temprana del tramo
      if (tr.salidaReal && tr.salidaReal !== '--:--:--') {
        const [h, m, s] = tr.salidaReal.split(':').map(Number);
        const exitSec = h * 3600 + m * 60 + (s || 0);
        const targetSec = segOuttimeMin * 60;
        if (exitSec < targetSec) {
          const diffSec = targetSec - exitSec;
          minutosSalidaTemprano += Math.ceil(diffSec / 60);
        }
      }
    }
  } else {
    // Turno simple (Corrido / Nocturno / Especial)
    if (primerIngresoItem) {
      const entMin = parseTimeToMinutes(primerIngresoItem.hora);
      if (tipo === 'NOCTURNO') {
        const effectiveEntMin = entMin < 12 * 60 ? entMin + 1440 : entMin;
        if (effectiveEntMin > targetEntryMin + toleranceMin) {
          minutosTardanza = effectiveEntMin - targetEntryMin;
        }
      } else {
        if (entMin > targetEntryMin + toleranceMin) {
          minutosTardanza = entMin - targetEntryMin;
        }
      }
    }

    if (ultimaSalidaItem && ultimaSalidaItem.hora && targetExitMin > 0) {
      const [h, m, s] = ultimaSalidaItem.hora.split(':').map(Number);
      const exitSec = h * 3600 + m * 60 + (s || 0);
      const targetSec = targetExitMin * 60;
      if (exitSec < targetSec) {
        const diffSec = targetSec - exitSec;
        if (diffSec <= 4 * 3600) {
          minutosSalidaTemprano = Math.ceil(diffSec / 60);
        }
      }
    }
  }

  if (minutosTardanza > 0) {
    estadoAcceso = 'LATE';
  }

  const tramosCompletos = tramos.filter(t => t.estadoTramo === 'COMPLETO');
  const tieneIncompleto = tramos.some(t => t.estadoTramo === 'SIN_SALIDA' || t.estadoTramo === 'SIN_ENTRADA') || (clean.length === 1);
  if (tieneIncompleto && tramosCompletos.length === 0) {
    estadoAcceso = 'INCOMPLETE';
  }

  const leave = getUserLeaveOnDate(userid, workDate);
  if (leave && (estadoAcceso === 'INCOMPLETE' || minutosTardanza === 0)) {
    estadoAcceso = 'EXCEPCION';
  }

  const hol = getHolidayOnDate(workDate);
  const esFeriado = Boolean(hol);
  const nombreFeriado = hol ? hol.nombre : null;
  if (esFeriado) {
    if (clean.length > 0) {
      estadoAcceso = 'FERIADO_TRABAJADO';
    } else {
      estadoAcceso = 'FERIADO';
    }
  }

  const horasTrabajadasNum = Number((totalTrabajadoMs / (1000 * 3600)).toFixed(2));
  const horasDescansoNum = Number((totalDescansoMs / (1000 * 3600)).toFixed(2));

  return {
    userid,
    legajo: user.legajo,
    empleado: user.nombre,
    deptId: user.deptId,
    departamento: user.departamento,
    fecha: workDate,
    tipoHorario: tipo,
    horarioAsignado: horarioAsignadoStr,
    horasTeoricas,
    entradaReal: primerIngreso,
    salidaReal: ultimaSalida,
    totalFichadas: clean.length,
    minutosTardanza,
    minutosSalidaTemprano,
    esFeriado,
    nombreFeriado,
    horasTrabajadasNum,
    horasDescansoNum,
    horasTrabajadas: horasTrabajadasNum > 0 ? `${horasTrabajadasNum.toFixed(2)} hs` : (leave ? `Excepción (${leave.className})` : (esFeriado ? `Feriado (${nombreFeriado})` : 'Sin Salida')),
    horasDescanso: `${horasDescansoNum.toFixed(2)} hs`,
    duracionHoras: horasTrabajadasNum > 0 ? `${horasTrabajadasNum.toFixed(2)} hs` : (leave ? `Excepción (${leave.className})` : (esFeriado ? `Feriado (${nombreFeriado})` : 'Sin Salida')),
    cantidadTramos: tramos.length,
    tramos: tramos,
    detalleTramos: tramos,
    estado: estadoAcceso,
    excepcion: leave ? {
      classId: leave.classId,
      className: leave.className,
      showAs: leave.showAs,
      whys: leave.whys
    } : null,
    molineteEntrada: primerIngresoItem ? primerIngresoItem.molineteNombre : null,
    molineteSalida: ultimaSalidaItem ? ultimaSalidaItem.molineteNombre : null,
    fichadasRaw: clean.map(c => ({
      hora: c.hora,
      tipoRegistro: c.tipoRegistro,
      tipoRegistroTexto: c.tipoRegistroTexto,
      molineteId: c.molineteId,
      molineteNombre: c.molineteNombre
    }))
  };
};

const trramosCompletosCount = (tramos) => {
  return tramos.filter(t => t.estadoTramo === 'COMPLETO').length;
};

// Main Attendance Calculation Engine (agrupado por jornada operativa 06:00 a 06:00)
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
  limit = 50,
  exportAll = false
}) => {
  const startTime = Date.now();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;
  const defaultTolerance = parseInt(toleranciaMin, 10) || 15;

  let targetUserid = null;
  if (searchLegajo) {
    for (const [uid, u] of usersMap.entries()) {
      if (u.legajo.toLowerCase() === searchLegajo) {
        targetUserid = uid;
        break;
      }
    }
  }

  // Filtrado de base usando índices de fecha operativa (corte de 6am a 6am)
  const baseCheckins = getCheckinsForFilter({ fechaDesde, fechaHasta, userid: targetUserid, useOperationalDate: true });
  let filteredCheckins = baseCheckins;
  if (searchLegajo || searchEmpleado || filterDept !== null || (baseCheckins === checkinList && (fechaDesde || fechaHasta))) {
    filteredCheckins = baseCheckins.filter(item => {
      if (searchLegajo && !item.legajo.toLowerCase().includes(searchLegajo)) return false;
      if (searchEmpleado && !item.empleado.toLowerCase().includes(searchEmpleado)) return false;
      if (filterDept !== null && item.deptId !== filterDept) return false;
      if (baseCheckins === checkinList) {
        if (fechaDesde && item.fechaOperativa < fechaDesde) return false;
        if (fechaHasta && item.fechaOperativa > fechaHasta) return false;
      }
      return true;
    });
  }

  // Agrupar fichadas por (userid, fechaOperativa)
  const userOpDateMap = new Map();
  for (let i = 0; i < filteredCheckins.length; i++) {
    const c = filteredCheckins[i];
    const key = `${c.userid}_${c.fechaOperativa}`;
    if (!userOpDateMap.has(key)) {
      userOpDateMap.set(key, { userid: c.userid, opDate: c.fechaOperativa, checkins: [] });
    }
    userOpDateMap.get(key).checkins.push(c);
  }

  const summary = [];
  let totalPuntual = 0;
  let totalTardanzas = 0;
  let totalIncompletos = 0;
  let totalMinutosTardanza = 0;
  let totalHorasNetasGlobal = 0;
  let totalHorasDescansoGlobal = 0;

  // Procesar cada par de (usuario, jornada operativa)
  userOpDateMap.forEach(({ userid, opDate, checkins }) => {
    if (fechaDesde && opDate < fechaDesde) return;
    if (fechaHasta && opDate > fechaHasta) return;

    const user = usersMap.get(userid) || {
      legajo: 'Desconocido',
      nombre: `Usuario #${userid}`,
      departamento: 'Desconocido',
      deptId: 0
    };

    const assignedTimetables = getAssignedTimetables(userid, opDate);
    const dayAttendance = calculateUserDayAttendance({
      userid,
      user,
      workDate: opDate,
      checkins,
      assignedTimetables,
      defaultTolerance,
      horarioEntrada,
      horarioSalida
    });

    // Filtros adicionales por tipoHorario y estado
    if (tipoHorario && tipoHorario !== 'TODOS' && dayAttendance.tipoHorario !== tipoHorario) {
      return;
    }
    if (estado && estado !== '' && dayAttendance.estado !== estado) {
      return;
    }

    if (dayAttendance.estado === 'PUNCTUAL') totalPuntual++;
    else if (dayAttendance.estado === 'LATE') totalTardanzas++;
    else if (dayAttendance.estado === 'INCOMPLETE') totalIncompletos++;

    totalMinutosTardanza += dayAttendance.minutosTardanza;
    totalHorasNetasGlobal += dayAttendance.horasTrabajadasNum;
    totalHorasDescansoGlobal += dayAttendance.horasDescansoNum;

    summary.push(dayAttendance);
  });

  // Ordenar según ordenFecha ('ASC' o 'DESC')
  if (ordenFecha && ordenFecha.toUpperCase() === 'DESC') {
    summary.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.legajo.localeCompare(b.legajo));
  } else {
    summary.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.legajo.localeCompare(b.legajo));
  }

  const total = summary.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (pageNum - 1) * pageSize;
  const data = exportAll ? summary : summary.slice(offset, offset + pageSize);
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
      totalHorasNetas: Number(totalHorasNetasGlobal.toFixed(1)),
      totalHorasDescanso: Number(totalHorasDescansoGlobal.toFixed(1)),
      promedioTardanzaMin: totalTardanzas > 0 ? Number((totalMinutosTardanza / totalTardanzas).toFixed(1)) : 0
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
  const currentDtStr = getLocalNowStr();
  const targetDate = fecha || getOperationalDate(currentDtStr, 'IN');
  
  // Utilizar índice de fecha operativa (jornadas de 06:00 AM a 06:00 AM)
  const dayCheckins = checkinsByOperationalDate.get(targetDate) || [];
  
  // Agrupar fichadas del día operativo por usuario
  const userCheckinsMap = new Map();
  for (let i = 0; i < dayCheckins.length; i++) {
    const c = dayCheckins[i];
    if (!userCheckinsMap.has(c.userid)) userCheckinsMap.set(c.userid, []);
    userCheckinsMap.get(c.userid).push(c);
  }

  const resumen = {
    Permanente: { total: 0, ingresaron: 0, adentro: 0, descansoSalieron: 0, faltan: 0, porcentaje: 0, porcentajeAdentro: 0 },
    Eventual: { total: 0, ingresaron: 0, adentro: 0, descansoSalieron: 0, faltan: 0, porcentaje: 0, porcentajeAdentro: 0 },
    Transitorio: { total: 0, ingresaron: 0, adentro: 0, descansoSalieron: 0, faltan: 0, porcentaje: 0, porcentajeAdentro: 0 },
    General: { total: 0, ingresaron: 0, adentro: 0, descansoSalieron: 0, faltan: 0, porcentaje: 0, porcentajeAdentro: 0 }
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
      adentro: 0,
      descansoSalieron: 0,
      faltan: 0,
      porcentaje: 0
    });
  });

  const personalActivo = [];

  usersMap.forEach(u => {
    const cat = classifyDepartment(u.departamento);
    const uCheckins = (userCheckinsMap.get(u.userid) || []).sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));
    const isPresent = uCheckins.length > 0;
    const lastCheckin = isPresent ? uCheckins[uCheckins.length - 1] : null;
    const isAdentro = isPresent && lastCheckin.tipoRegistro === 'IN';
    const isSalio = isPresent && lastCheckin.tipoRegistro === 'OUT';

    resumen[cat].total++;
    resumen.General.total++;

    if (isPresent) {
      resumen[cat].ingresaron++;
      resumen.General.ingresaron++;
      if (isAdentro) {
        resumen[cat].adentro++;
        resumen.General.adentro++;
      } else {
        resumen[cat].descansoSalieron++;
        resumen.General.descansoSalieron++;
      }

      personalActivo.push({
        userid: u.userid,
        legajo: u.legajo,
        nombre: u.nombre,
        departamento: u.departamento,
        categoria: cat,
        estado: isAdentro ? 'ADENTRO' : 'SALIÓ / DESCANSO',
        primerIngreso: uCheckins[0].hora,
        ultimoRegistro: {
          hora: lastCheckin.hora,
          tipo: lastCheckin.tipoRegistro,
          tipoTexto: lastCheckin.tipoRegistroTexto,
          molinete: lastCheckin.molineteNombre
        },
        totalMarcaciones: uCheckins.length
      });
    } else {
      resumen[cat].faltan++;
      resumen.General.faltan++;
    }

    const dStat = deptoStatsMap.get(u.deptId);
    if (dStat) {
      dStat.total++;
      if (isPresent) {
        dStat.ingresaron++;
        if (isAdentro) dStat.adentro++;
        else dStat.descansoSalieron++;
      } else {
        dStat.faltan++;
      }
    }
  });

  Object.keys(resumen).forEach(k => {
    resumen[k].porcentaje = resumen[k].total > 0 
      ? Number(((resumen[k].ingresaron / resumen[k].total) * 100).toFixed(1)) 
      : 0;
    resumen[k].porcentajeAdentro = resumen[k].total > 0
      ? Number(((resumen[k].adentro / resumen[k].total) * 100).toFixed(1))
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
    jornadaOperativa: `${targetDate} 06:00 a ${targetDate} (+1d 06:00)`,
    resumen,
    censoDepartamentos,
    personalActivo
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
    exportAll: true
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
        totalDescansoHs: 0,
        sinEntradaVeces: 0,
        sinSalidaVeces: 0,
        tiposHorarioSet: new Set()
      });
    }

    const uStat = userStatsMap.get(item.userid);
    uStat.trabajadosDias++;
    uStat.llegadasTardeMin += item.minutosTardanza;
    uStat.salidasTempranoMin += (item.minutosSalidaTemprano || 0);
    if (item.horasTrabajadasNum !== undefined) {
      uStat.totalTrabajadoHs += item.horasTrabajadasNum;
      uStat.totalDescansoHs += (item.horasDescansoNum || 0);
    } else if (item.duracionHoras && item.duracionHoras.includes('hs')) {
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
      totalDescansoHs: 0,
      sinEntradaVeces: 0,
      sinSalidaVeces: 0,
      tiposHorarioSet: new Set()
    };

    // Detección exacta de días laborables, feriados y descansos según el cronograma del empleado
    let laboralesDias = 0;
    let feriadosDias = 0;
    let feriadosTrabajadosDias = 0;
    let descansosDias = 0;

    for (let cur = new Date(startStr + 'T12:00:00'); cur <= new Date(endStr + 'T12:00:00'); cur.setDate(cur.getDate() + 1)) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      const dStr = `${y}-${m}-${d}`;
      const dow = cur.getDay();

      const assigned = getAssignedTimetables(u.userid, dStr);
      const isScheduled = assigned.length > 0 && !assigned.some(t => t.isDayOff);
      const isDefaultWorkday = (!userShiftMap.has(u.userid) || userShiftMap.get(u.userid).length === 0) && (dow >= 1 && dow <= 5);
      const isWorkday = isScheduled || isDefaultWorkday;

      const hol = getHolidayOnDate(dStr);
      const hasPunches = checkinsByUserAndOpDate.has(`${u.userid}_${dStr}`);

      if (hol) {
        if (hasPunches) {
          feriadosTrabajadosDias++;
          laboralesDias++;
        } else {
          feriadosDias++;
          if (isWorkday) {
            laboralesDias++;
          }
        }
      } else if (isWorkday) {
        laboralesDias++;
      } else {
        descansosDias++;
      }
    }

    const trabajadosDias = uStat.trabajadosDias;
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

    licenciasDias = Math.min(laboralesDias, licenciasDias);
    // Ausente: días laborables en los que no se trabajó, no fue feriado y no hubo licencia justificada
    const ausenteDias = Math.max(0, laboralesDias - trabajadosDias - feriadosDias - licenciasDias);
    const ausenteInjustificadoDias = ausenteDias;

    const tipos = Array.from(uStat.tiposHorarioSet);
    const tipoHabitual = tipos.length > 0 ? tipos.join(', ') : 'CORRIDO';

    const presentismoPct = laboralesDias > 0 
      ? Number((((trabajadosDias + feriadosDias + licenciasDias) / laboralesDias) * 100).toFixed(1))
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
      feriadosDias,
      feriadosTrabajadosDias,
      licenciasDias,
      ausenteInjustificadoDias,
      descansosDias,
      licenciasDetalle: Array.from(licenciasSet).join(', '),
      tiempoExtraMin: 0,
      overtime1Min: 0,
      overtime2Min: 0,
      overtime3Min: 0,
      tiempoLibreHs: 0,
      sinEntradaVeces: uStat.sinEntradaVeces,
      sinSalidaVeces: uStat.sinSalidaVeces,
      tiempoTrabajadoHs: Number(uStat.totalTrabajadoHs.toFixed(2)),
      tiempoDescansoHs: Number(uStat.totalDescansoHs.toFixed(2)),
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
  let totalTiempoDescansoHsGlobal = 0;
  let sumPresentismo = 0;

  statsList.forEach(s => {
    totalTrabajadosDiasGlobal += s.trabajadosDias;
    totalAusenteDiasGlobal += s.ausenteDias;
    totalLlegadasTardeMinGlobal += s.llegadasTardeMin;
    totalTiempoTrabajadoHsGlobal += s.tiempoTrabajadoHs;
    totalTiempoDescansoHsGlobal += (s.tiempoDescansoHs || 0);
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
      totalHorasDescanso: Number(totalTiempoDescansoHsGlobal.toFixed(1)),
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
  const currentDtStr = getLocalNowStr();
  const targetDate = fecha || getOperationalDate(currentDtStr, 'IN');

  const searchLegajo = legajo ? legajo.toString().toLowerCase().trim() : null;
  const searchEmpleado = empleado ? empleado.toString().toLowerCase().trim() : null;
  const filterDept = deptId !== undefined && deptId !== '' ? Number(deptId) : null;

  // Obtener todas las fichadas de la jornada operativa correspondiente (06:00 a 06:00)
  const targetCheckinsList = checkinsByOperationalDate.get(targetDate) || [];
  const checkinsTargetMap = new Map();

  for (let i = 0; i < targetCheckinsList.length; i++) {
    const c = targetCheckinsList[i];
    if (!checkinsTargetMap.has(c.userid)) checkinsTargetMap.set(c.userid, []);
    checkinsTargetMap.get(c.userid).push(c);
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
    const userCheckins = checkinsTargetMap.get(u.userid) || [];

    let horarioTeoricoStr = '08:00 - 17:00';
    let horasTeoricas = 9.0;
    if (assignedTTs.length === 1) {
      const tt = assignedTTs[0];
      horarioTeoricoStr = `${tt.intime} - ${tt.outtime}${tt.isNightShift ? ' (+1d)' : ''}`;
      horasTeoricas = tt.longtime ? Number((tt.longtime / 60).toFixed(1)) : 8.0;
    } else if (assignedTTs.length >= 2) {
      const t1 = assignedTTs[0];
      const t2 = assignedTTs[1];
      horarioTeoricoStr = `${t1.intime}-${t1.outtime} / ${t2.intime}-${t2.outtime}`;
      horasTeoricas = Number(((t1.longtime + t2.longtime) / 60).toFixed(1));
    }

    if (userCheckins.length === 0) {
      const leave = getUserLeaveOnDate(u.userid, targetDate);
      if (leave) {
        countExcepciones++;
        resultList.push({
          userid: u.userid,
          legajo: u.legajo,
          empleado: u.nombre,
          deptId: u.deptId,
          departamento: u.departamento,
          fecha: targetDate,
          tipoHorario: 'CORRIDO',
          horarioTeorico: horarioTeoricoStr,
          horasTeoricas,
          fichadasCount: 0,
          entradaReal: '--:--:--',
          salidaReal: '--:--:--',
          horasRealesNetas: '0.00 hs',
          horasDescanso: '0.00 hs',
          duracionRealHs: `Excepción (${leave.className})`,
          estado: 'EXCEPCION',
          excepcion: {
            classId: leave.classId,
            className: leave.className,
            showAs: leave.showAs,
            whys: leave.whys
          },
          tramos: [],
          fichadasRaw: []
        });
      } else {
        countAusentes++;
        resultList.push({
          userid: u.userid,
          legajo: u.legajo,
          empleado: u.nombre,
          deptId: u.deptId,
          departamento: u.departamento,
          fecha: targetDate,
          tipoHorario: 'CORRIDO',
          horarioTeorico: horarioTeoricoStr,
          horasTeoricas,
          fichadasCount: 0,
          entradaReal: '--:--:--',
          salidaReal: '--:--:--',
          horasRealesNetas: '0.00 hs',
          horasDescanso: '0.00 hs',
          duracionRealHs: 'Sin Registro',
          estado: 'ABSENT',
          excepcion: null,
          tramos: [],
          fichadasRaw: []
        });
      }
      return;
    }

    // Calcular jornada completa mediante el motor unificado de tramos y descansos
    const att = calculateUserDayAttendance({
      userid: u.userid,
      user: u,
      workDate: targetDate,
      checkins: userCheckins,
      assignedTimetables: assignedTTs
    });

    if (tipoHorario !== 'TODOS' && att.tipoHorario !== tipoHorario) {
      return;
    }

    if (att.tipoHorario === 'NOCTURNO') countNocturno++;
    else if (att.tipoHorario === 'CORTADO') countCortado++;
    else countCorrido++;

    resultList.push({
      userid: u.userid,
      legajo: u.legajo,
      empleado: u.nombre,
      deptId: u.deptId,
      departamento: u.departamento,
      fecha: targetDate,
      tipoHorario: att.tipoHorario,
      horarioTeorico: att.horarioAsignado || horarioTeoricoStr,
      horasTeoricas: att.horasTeoricas !== undefined ? att.horasTeoricas : horasTeoricas,
      fichadasCount: att.totalFichadas,
      entradaReal: att.entradaReal,
      salidaReal: att.salidaReal,
      horasRealesNetas: att.horasTrabajadas,
      horasDescanso: att.horasDescanso,
      duracionRealHs: att.horasTrabajadas,
      estado: att.estado,
      excepcion: att.excepcion,
      tramos: att.detalleTramos,
      molineteEntrada: att.molineteEntrada,
      molineteSalida: att.molineteSalida,
      fichadasRaw: att.fichadasRaw
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
    jornadaOperativa: `${targetDate} 06:00 a ${targetDate} (+1d 06:00)`,
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

export const getHolidays = () => {
  return [...holidaysList].sort((a, b) => a.fecha.localeCompare(b.fecha));
};

export const getHolidayOnDate = (dateStr) => {
  if (!dateStr) return null;
  const dStr = dateStr.substring(0, 10);
  return holidaysMap.get(dStr) || null;
};

export const addHoliday = ({ fecha, nombre, tipo = 'nacional' }) => {
  if (!fecha || !nombre) throw new Error('fecha y nombre son requeridos');
  const dStr = fecha.substring(0, 10);
  const item = { fecha: dStr, nombre: nombre.trim(), tipo: tipo.trim() };
  holidaysMap.set(dStr, item);
  holidaysList = holidaysList.filter(h => h.fecha !== dStr);
  holidaysList.push(item);
  holidaysList.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const filePath = path.join(DATA_DIR, 'holidays.json');
  fs.writeFileSync(filePath, JSON.stringify(holidaysList, null, 2), 'utf8');
  return item;
};

export const removeHoliday = (fecha) => {
  if (!fecha) return false;
  const dStr = fecha.substring(0, 10);
  holidaysMap.delete(dStr);
  holidaysList = holidaysList.filter(h => h.fecha !== dStr);
  const filePath = path.join(DATA_DIR, 'holidays.json');
  fs.writeFileSync(filePath, JSON.stringify(holidaysList, null, 2), 'utf8');
  return true;
};


