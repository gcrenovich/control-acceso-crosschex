#!/usr/bin/env python3
# ==============================================================================
# SINCRONIZADOR DIRECTO: 10.0.0.89 (CROSSCHEX SMB) -> 10.0.0.10 (UBUNTU)
# ==============================================================================
# Este script:
# 1. Asegura el montaje CIFS de \\10.0.0.89\CrossChex Standard en /mnt/crosschex
# 2. Compara fecha y tamaño de CrossChex.mdb para evitar transferencias redundantes
# 3. Copia el archivo directamente desde 10.0.0.89 a 10.0.0.10
# 4. Exporta las tablas a JSON y CSV usando mdbtools
# 5. Notifica al backend local (puerto 3005) para recargar el dataset en memoria
# ==============================================================================

import os
import sys
import csv
import json
import shutil
import subprocess
import time
from datetime import datetime

# Rutas principales
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(BASE_DIR, "data")
SMB_SHARE = "//10.0.0.89/CrossChex Standard"
MOUNT_POINT = "/mnt/crosschex"
REMOTE_MDB = os.path.join(MOUNT_POINT, "DB", "CrossChex.mdb")
LOCAL_REPLICA = os.path.join(DATA_DIR, "CrossChex_Local.mdb")
TOKEN_FILE = os.path.join(DATA_DIR, ".last_sync_token")
CREDENTIALS_FILE = "/etc/crosschex-credentials"

def log(msg, level="INFO"):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)

def ensure_mount():
    """Verifica si /mnt/crosschex está montado y accesible. Si no, lo monta."""
    if os.path.isfile(REMOTE_MDB):
        return True

    log("El recurso SMB no está montado o accesible. Intentando montar...", "WARN")
    os.makedirs(MOUNT_POINT, exist_ok=True)

    # Intentar con archivo de credenciales o credenciales directas
    if os.path.isfile(CREDENTIALS_FILE):
        cred_opt = f"credentials={CREDENTIALS_FILE}"
    else:
        cred_opt = "username=anviz,password=anviz"

    cmd = [
        "mount", "-t", "cifs", SMB_SHARE, MOUNT_POINT,
        "-o", f"{cred_opt},ro,noperm,vers=3.0"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        # Reintentar sin especificar versión de protocolo
        cmd_fallback = [
            "mount", "-t", "cifs", SMB_SHARE, MOUNT_POINT,
            "-o", f"{cred_opt},ro,noperm"
        ]
        res_fallback = subprocess.run(cmd_fallback, capture_output=True, text=True)
        if res_fallback.returncode != 0:
            log(f"Error al montar {SMB_SHARE}: {res_fallback.stderr.strip()}", "ERROR")
            return False

    if os.path.isfile(REMOTE_MDB):
        log(f"Montaje exitoso en {MOUNT_POINT}.", "INFO")
        return True
    else:
        log(f"Montado pero no se encontró {REMOTE_MDB}", "ERROR")
        return False

def parse_access_date(date_str):
    """Normaliza fechas de Access 'MM/DD/YY HH:MM:SS' o 'YYYY-MM-DD...' a 'YYYY-MM-DD HH:mm:ss'"""
    if not date_str or date_str == '""':
        return ""
    val = date_str.strip('"').strip()
    if not val:
        return ""

    if '/' in val:
        try:
            parts = val.split(' ')
            d_part = parts[0]
            t_part = parts[1] if len(parts) > 1 else "00:00:00"
            m, d, y = d_part.split('/')
            if len(y) == 2:
                y = f"20{y}"
            return f"{y}-{m.zfill(2)}-{d.zfill(2)} {t_part}"
        except Exception:
            return val
    return val

def export_json_table(mdb_path, table_name, out_file, custom_transform=None):
    """Exporta una tabla completa a JSON mediante mdb-json."""
    tmp_file = f"{out_file}.tmp"
    cmd = ["mdb-json", mdb_path, table_name]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    
    items = []
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if custom_transform:
                obj = custom_transform(obj)
            if obj is not None:
                items.append(obj)
        except Exception:
            continue
            
    proc.wait()
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)
        
    os.replace(tmp_file, out_file)
    return len(items)

def export_checkinout(mdb_path, out_file):
    """Exporta Checkinout a CSV con formato optimizado Logid,userid,CheckTime,CheckType,Sensorid,temperature"""
    tmp_file = f"{out_file}.tmp"
    cmd = ["mdb-export", "-D", "%Y-%m-%d %H:%M:%S", mdb_path, "Checkinout"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    
    reader = csv.reader(proc.stdout)
    try:
        header = next(reader)
    except StopIteration:
        proc.wait()
        return 0

    col_map = {col.strip(): i for i, col in enumerate(header)}
    idx_logid = col_map.get("Logid")
    idx_uid = col_map.get("userid")
    idx_time = col_map.get("CheckTime")
    idx_type = col_map.get("CheckType")
    idx_sensor = col_map.get("Sensorid")
    idx_temp = col_map.get("temperature")

    count = 0
    with open(tmp_file, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Logid", "userid", "CheckTime", "CheckType", "Sensorid", "temperature"])
        
        for row in reader:
            if not row or len(row) <= max(idx_logid, idx_uid, idx_time):
                continue
            logid = row[idx_logid]
            uid = row[idx_uid]
            raw_time = row[idx_time]
            ctime = parse_access_date(raw_time)
            ctype = row[idx_type] if idx_type is not None and idx_type < len(row) and row[idx_type] != "" else "0"
            sensor = row[idx_sensor] if idx_sensor is not None and idx_sensor < len(row) and row[idx_sensor] != "" else "1"
            temp = row[idx_temp] if idx_temp is not None and idx_temp < len(row) and row[idx_temp] != "" else "0"

            writer.writerow([logid, uid, ctime, ctype, sensor, temp])
            count += 1

    proc.wait()
    os.replace(tmp_file, out_file)
    return count

def export_user_temp_shifts(mdb_path, out_file):
    """Exporta UserTempShift a CSV: userid,Timeid,WorkDate"""
    tmp_file = f"{out_file}.tmp"
    cmd = ["mdb-export", mdb_path, "UserTempShift"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    
    reader = csv.reader(proc.stdout)
    try:
        header = next(reader)
    except StopIteration:
        proc.wait()
        return 0

    col_map = {col.strip(): i for i, col in enumerate(header)}
    idx_uid = col_map.get("userid")
    idx_tid = col_map.get("Timeid")
    idx_date = col_map.get("WorkDate")

    count = 0
    with open(tmp_file, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["userid", "Timeid", "WorkDate"])
        for row in reader:
            if not row or len(row) <= max(idx_uid, idx_tid, idx_date):
                continue
            uid = row[idx_uid]
            tid = row[idx_tid]
            wdate = parse_access_date(row[idx_date])[:10]
            writer.writerow([uid, tid, wdate])
            count += 1

    proc.wait()
    os.replace(tmp_file, out_file)
    return count

def main():
    force = "--force" in sys.argv
    log("==========================================================")
    log("Iniciando sincronización directa CrossChex (10.0.0.89 -> 10.0.0.10)...")

    os.makedirs(DATA_DIR, exist_ok=True)

    if not ensure_mount():
        log("No se pudo conectar a la PC 10.0.0.89. Compruebe que esté encendida y en red.", "ERROR")
        if os.path.isfile(LOCAL_REPLICA):
            log("Utilizando última réplica local disponible.", "WARN")
        else:
            sys.exit(1)

    # 1. Comprobar si la base en 10.0.0.89 cambió
    source_to_use = LOCAL_REPLICA
    need_copy = True

    try:
        stat_remote = os.stat(REMOTE_MDB)
        current_token = f"{int(stat_remote.st_mtime)}_{stat_remote.st_size}"

        if os.path.isfile(LOCAL_REPLICA):
            stat_local = os.stat(LOCAL_REPLICA)
            if stat_local.st_size == stat_remote.st_size and not force:
                need_copy = False
                log("La réplica local coincide en tamaño con la original de 10.0.0.89.", "INFO")

        if os.path.isfile(TOKEN_FILE) and not force and not need_copy:
            with open(TOKEN_FILE, "r") as tf:
                saved_token = tf.read().strip()
            if saved_token == current_token:
                log("Base de datos sin modificaciones desde la última sincronización. Proceso completado.", "INFO")
                log("==========================================================")
                sys.exit(0)

        if need_copy:
            log(f"Copiando base viva ({stat_remote.st_size / (1024*1024):.2f} MB) desde 10.0.0.89...", "INFO")
            t_start = time.time()
            tmp_download = f"{LOCAL_REPLICA}.download.tmp"
            shutil.copyfile(REMOTE_MDB, tmp_download)
            if os.path.getsize(tmp_download) == stat_remote.st_size:
                os.replace(tmp_download, LOCAL_REPLICA)
                t_end = time.time()
                log(f"Réplica actualizada exitosamente en {t_end - t_start:.2f}s.", "INFO")
            else:
                log("Copia incompleta. Se conserva réplica anterior.", "WARN")
                if os.path.isfile(tmp_download):
                    os.remove(tmp_download)

        source_to_use = LOCAL_REPLICA
        token_to_save = current_token

    except Exception as e:
        log(f"Aviso al acceder al origen remoto: {e}. Usando réplica local si existe.", "WARN")
        if not os.path.isfile(LOCAL_REPLICA):
            log("Error crítico: No existe réplica local y el origen no respondió.", "ERROR")
            sys.exit(1)
        token_to_save = None

    # 2. Crear copia de trabajo temporal para evitar bloqueos
    work_mdb = f"/tmp/crosschex_work_{int(time.time())}.mdb"
    log("Creando copia de trabajo temporal...", "INFO")
    shutil.copyfile(source_to_use, work_mdb)

    try:
        log("Exportando tablas del sistema...", "INFO")

        # Dept
        n_dept = export_json_table(work_mdb, "Dept", os.path.join(DATA_DIR, "departments.json"))
        log(f" -> Departamentos: {n_dept} registros.")

        # Userinfo
        def transform_user(u):
            return {
                "userid": u.get("userid"),
                "UserCode": u.get("UserCode", ""),
                "Name": u.get("Name", "Sin Nombre"),
                "Cardnum": u.get("Cardnum", ""),
                "Deptid": u.get("Deptid", 0)
            }
        n_users = export_json_table(work_mdb, "Userinfo", os.path.join(DATA_DIR, "users.json"), transform_user)
        log(f" -> Empleados (Userinfo): {n_users} registros.")

        # TimeTable
        n_tt = export_json_table(work_mdb, "TimeTable", os.path.join(DATA_DIR, "timetables.json"))
        log(f" -> Horarios (TimeTable): {n_tt} registros.")

        # Schedule
        n_sch = export_json_table(work_mdb, "Schedule", os.path.join(DATA_DIR, "schedules.json"))
        log(f" -> Ciclos de turnos (Schedule): {n_sch} registros.")

        # SchTime
        n_st = export_json_table(work_mdb, "SchTime", os.path.join(DATA_DIR, "sch_times.json"))
        log(f" -> Asignación de días (SchTime): {n_st} registros.")

        # UserShift
        def transform_usershift(us):
            return {
                "userid": us.get("userid"),
                "Schid": us.get("Schid"),
                "BeginDate": parse_access_date(us.get("BeginDate", ""))[:10],
                "EndDate": parse_access_date(us.get("EndDate", ""))[:10]
            }
        n_us = export_json_table(work_mdb, "UserShift", os.path.join(DATA_DIR, "user_shifts.json"), transform_usershift)
        log(f" -> Turnos asignados (UserShift): {n_us} registros.")

        # UserTempShift (CSV)
        n_uts = export_user_temp_shifts(work_mdb, os.path.join(DATA_DIR, "user_temp_shifts.csv"))
        log(f" -> Turnos diarios (UserTempShift): {n_uts} registros.")

        # LeaveClass
        n_lc = export_json_table(work_mdb, "LeaveClass", os.path.join(DATA_DIR, "leave_classes.json"))
        log(f" -> Clases de licencias (LeaveClass): {n_lc} registros.")

        # UserLeave
        def transform_userleave(ul):
            return {
                "Lsh": ul.get("Lsh"),
                "userid": ul.get("userid"),
                "LeaveClassid": ul.get("LeaveClassid"),
                "BeginTime": parse_access_date(ul.get("BeginTime", "")),
                "EndTime": parse_access_date(ul.get("EndTime", "")),
                "Whys": ul.get("Whys", "")
            }
        n_ul = export_json_table(work_mdb, "UserLeave", os.path.join(DATA_DIR, "user_leaves.json"), transform_userleave)
        log(f" -> Permisos y excepciones (UserLeave): {n_ul} registros.")

        # FingerClient (Dispositivos / Molinetes)
        try:
            n_dev = export_json_table(work_mdb, "FingerClient", os.path.join(DATA_DIR, "devices.json"))
            log(f" -> Dispositivos/Molinetes (FingerClient): {n_dev} registros.")
        except Exception:
            pass

        # Holiday
        try:
            n_hol = export_json_table(work_mdb, "Holiday", os.path.join(DATA_DIR, "crosschex_holidays.json"))
            log(f" -> Feriados CrossChex: {n_hol} registros.")
        except Exception:
            pass

        # Checkinout (Marcaciones)
        t_chk_start = time.time()
        n_chk = export_checkinout(work_mdb, os.path.join(DATA_DIR, "checkinout.csv"))
        log(f" -> Marcaciones (Checkinout): {n_chk:,} filas exportadas en {time.time() - t_chk_start:.2f}s.")

        # Guardar token
        if token_to_save:
            with open(TOKEN_FILE, "w") as tf:
                tf.write(token_to_save)

        # Ajustar permisos para www-data / admin-irg
        for f in os.listdir(DATA_DIR):
            p = os.path.join(DATA_DIR, f)
            try:
                os.chmod(p, 0o664)
            except Exception:
                pass

        log("¡Exportación completada exitosamente!", "INFO")

    finally:
        if os.path.isfile(work_mdb):
            os.remove(work_mdb)

    # 3. Notificar al backend en caliente
    log("Notificando al backend Node.js en 127.0.0.1:3005...", "INFO")
    try:
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:3005/api/sync/reload", data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            log("Backend notificado: dataset recargado en memoria.", "INFO")
    except Exception as ex:
        log(f"Nota al notificar backend: {ex}", "WARN")

    log("Sincronización directa 10.0.0.89 -> 10.0.0.10 finalizada con éxito.")
    log("==========================================================")

if __name__ == "__main__":
    main()
