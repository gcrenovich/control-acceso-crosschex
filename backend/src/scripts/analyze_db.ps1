$ErrorActionPreference = "Stop"
$dbPath = "C:\CrossChex_Replicas\CrossChex_Local.mdb"

if (!(Test-Path $dbPath)) {
    Write-Host "No se encontró el archivo MDB en $dbPath" -ForegroundColor Red
    exit 1
}

$fileInfo = Get-Item $dbPath
$sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "       ANALISIS INTEGRAL DE LA BASE DE DATOS CROSSCHEX           " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Archivo MDB: $dbPath"
Write-Host "Tamaño: $sizeMB MB"
Write-Host "Última Modificación: $($fileInfo.LastWriteTime)"
Write-Host ""

function Copy-SharedFile($src, $dst) {
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            $srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $dstStream = New-Object System.IO.FileStream($dst, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $srcStream.CopyTo($dstStream)
            $srcStream.Close()
            $dstStream.Close()
            return $true
        } catch {
            Write-Host "Intento $attempt/10: archivo ocupado, reintentando en 1s..."
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

$tempDb = "$env:TEMP\analyze_crosschex_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"
$ok = Copy-SharedFile $dbPath $tempDb
if (-not $ok) {
    Write-Host "No se pudo acceder al archivo tras 10 intentos." -ForegroundColor Red
    exit 1
}

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

# 1. TABLAS Y CONTEO DE REGISTROS
Write-Host "--- 1. TABLAS Y CANTIDAD TOTAL DE REGISTROS ---" -ForegroundColor Yellow
$tablesSchema = $conn.GetSchema("Tables")
$tableList = $tablesSchema | Where-Object { $_.TABLE_TYPE -eq 'TABLE' } | Select-Object -ExpandProperty TABLE_NAME

$tableStats = @()
foreach ($t in $tableList) {
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "SELECT COUNT(*) FROM [$t]"
        $count = $cmd.ExecuteScalar()
        $tableStats += [PSCustomObject]@{
            Tabla = $t
            Registros = [int64]$count
        }
    } catch {
        $tableStats += [PSCustomObject]@{
            Tabla = $t
            Registros = -1
        }
    }
}

$tableStats | Sort-Object Registros -Descending | Format-Table -AutoSize

# 2. ANALISIS DE CHECKINOUT (FICHADAS)
Write-Host "`n--- 2. ANALISIS PROFUNDO DE CHECKINOUT (FICHADAS) ---" -ForegroundColor Yellow
$cmdCheck = $conn.CreateCommand()
$cmdCheck.CommandText = "SELECT MIN(CheckTime) as MinFecha, MAX(CheckTime) as MaxFecha, COUNT(*) as Total FROM CHECKINOUT"
$rdrCheck = $cmdCheck.ExecuteReader()
if ($rdrCheck.Read()) {
    Write-Host "Total Fichadas: $($rdrCheck['Total'])"
    Write-Host "Primer Fichada Histórica: $($rdrCheck['MinFecha'])"
    Write-Host "Última Fichada Registrada: $($rdrCheck['MaxFecha'])"
}
$rdrCheck.Close()

# CheckType distribution
Write-Host "`nDistribución por CheckType (0: IN, 1: OUT, etc.):" -ForegroundColor Cyan
$cmdType = $conn.CreateCommand()
$cmdType.CommandText = "SELECT CheckType, COUNT(*) as Cantidad FROM CHECKINOUT GROUP BY CheckType ORDER BY CheckType"
$rdrType = $cmdType.ExecuteReader()
while ($rdrType.Read()) {
    $cType = $rdrType['CheckType']
    $label = if ($cType -eq 0) { "IN (Ingreso)" } elseif ($cType -eq 1) { "OUT (Salida)" } else { "Otro ($cType)" }
    Write-Host "  - CheckType $cType [$label]: $($rdrType['Cantidad']) fichadas"
}
$rdrType.Close()

# Sensorid distribution
Write-Host "`nDistribución por Sensor / Dispositivo (Sensorid):" -ForegroundColor Cyan
$cmdSensor = $conn.CreateCommand()
$cmdSensor.CommandText = "SELECT Sensorid, COUNT(*) as Cantidad FROM CHECKINOUT GROUP BY Sensorid ORDER BY Sensorid"
$rdrSensor = $cmdSensor.ExecuteReader()
while ($rdrSensor.Read()) {
    Write-Host "  - Sensorid $($rdrSensor['Sensorid']): $($rdrSensor['Cantidad']) fichadas"
}
$rdrSensor.Close()

# Distribución de fichadas por hora del día (0 a 23)
Write-Host "`nDistribución de Fichadas por Hora del Día (00:00 a 23:00):" -ForegroundColor Cyan
$cmdHour = $conn.CreateCommand()
$cmdHour.CommandText = "SELECT HOUR(CheckTime) as Hora, COUNT(*) as Cantidad FROM CHECKINOUT GROUP BY HOUR(CheckTime) ORDER BY HOUR(CheckTime)"
$rdrHour = $cmdHour.ExecuteReader()
$hourStats = @()
while ($rdrHour.Read()) {
    $h = [int]$rdrHour['Hora']
    $cant = [int64]$rdrHour['Cantidad']
    $hourStats += [PSCustomObject]@{
        Hora = "$($h.ToString('00')):00 - $($h.ToString('00')):59"
        Cantidad = $cant
    }
}
$rdrHour.Close()
$hourStats | Format-Table -AutoSize

# 3. ANALISIS DE USERINFO (EMPLEADOS / USUARIOS)
Write-Host "`n--- 3. ANALISIS DE USERINFO (EMPLEADOS) ---" -ForegroundColor Yellow
$cmdUser = $conn.CreateCommand()
$cmdUser.CommandText = "SELECT COUNT(*) as TotalUsers, COUNT(Userid) as UsersWithId FROM Userinfo"
$rdrUser = $cmdUser.ExecuteReader()
if ($rdrUser.Read()) {
    Write-Host "Total Empleados Registrados: $($rdrUser['TotalUsers'])"
}
$rdrUser.Close()

# Empleados con fichadas vs sin fichadas
$cmdActive = $conn.CreateCommand()
$cmdActive.CommandText = "SELECT COUNT(*) FROM (SELECT DISTINCT Userid FROM CHECKINOUT)"
$activeUsers = $cmdActive.ExecuteScalar()
Write-Host "Empleados que registran al menos 1 fichada: $activeUsers"
Write-Host "Empleados sin marcaciones registradas: $($tableStats.Where({$_.Tabla -eq 'Userinfo'}).Registros - $activeUsers)"

# 4. ANALISIS DE DEPT (DEPARTAMENTOS)
Write-Host "`n--- 4. ANALISIS DE DEPT (DEPARTAMENTOS) ---" -ForegroundColor Yellow
$cmdDept = $conn.CreateCommand()
$cmdDept.CommandText = "SELECT d.Deptid, d.DeptName, COUNT(u.Userid) as CantidadEmpleados FROM Dept d LEFT JOIN Userinfo u ON d.Deptid = u.Deptid GROUP BY d.Deptid, d.DeptName ORDER BY COUNT(u.Userid) DESC"
$rdrDept = $cmdDept.ExecuteReader()
$deptStats = @()
$totalDepts = 0
while ($rdrDept.Read()) {
    $totalDepts++
    if ($deptStats.Count -lt 15) {
        $deptStats += [PSCustomObject]@{
            DeptID = $rdrDept['Deptid']
            Departamento = $rdrDept['DeptName']
            Empleados = $rdrDept['CantidadEmpleados']
        }
    }
}
$rdrDept.Close()
Write-Host "Total Departamentos Configurados: $totalDepts"
Write-Host "Top 15 Departamentos con Mayor Plantilla:"
$deptStats | Format-Table -AutoSize

# 5. ANALISIS DE FINGERCLIENT (MOLINETES / DISPOSITIVOS)
Write-Host "`n--- 5. ANALISIS DE FINGERCLIENT (DISPOSITIVOS Y MOLINETES) ---" -ForegroundColor Yellow
$cmdDev = $conn.CreateCommand()
$cmdDev.CommandText = "SELECT Clientid, ClientNumber, ClientName, ipaddress, RecStatus, DeviceType FROM FingerClient"
$rdrDev = $cmdDev.ExecuteReader()
$devList = @()
while ($rdrDev.Read()) {
    $status = if ($rdrDev['RecStatus'] -eq 1) { "ENTRADA (IN)" } elseif ($rdrDev['RecStatus'] -eq 2) { "SALIDA (OUT)" } else { "OTRO" }
    $devList += [PSCustomObject]@{
        ID = $rdrDev['Clientid']
        Numero = $rdrDev['ClientNumber']
        Nombre = $rdrDev['ClientName']
        IP = $rdrDev['ipaddress']
        Sentido = $status
        Tipo = $rdrDev['DeviceType']
    }
}
$rdrDev.Close()
$devList | Format-Table -AutoSize

# 6. ANALISIS DE EXCEPCIONES Y LICENCIAS (USERLEAVE & LEAVECLASS)
Write-Host "`n--- 6. ANALISIS DE EXCEPCIONES Y LICENCIAS (USERLEAVE) ---" -ForegroundColor Yellow
$cmdLeave = $conn.CreateCommand()
$cmdLeave.CommandText = "SELECT lc.Classid, lc.ClassName, lc.ShowAs, COUNT(ul.Userid) as Cantidad FROM LeaveClass lc LEFT JOIN UserLeave ul ON lc.Classid = ul.LeaveClassid GROUP BY lc.Classid, lc.ClassName, lc.ShowAs ORDER BY COUNT(ul.Userid) DESC"
$rdrLeave = $cmdLeave.ExecuteReader()
$leaveStats = @()
while ($rdrLeave.Read()) {
    $leaveStats += [PSCustomObject]@{
        ClassID = $rdrLeave['Classid']
        Clase = $rdrLeave['ClassName']
        Codigo = $rdrLeave['ShowAs']
        Registros = $rdrLeave['Cantidad']
    }
}
$rdrLeave.Close()
$leaveStats | Format-Table -AutoSize

# 7. ANALISIS DE TURNOS (TIMETABLE & SCHCLASS)
Write-Host "`n--- 7. ANALISIS DE TURNOS Y HORARIOS (TIMETABLE & SCHCLASS) ---" -ForegroundColor Yellow
try {
    $cmdTT = $conn.CreateCommand()
    $cmdTT.CommandText = "SELECT TOP 1 * FROM TimeTable"
    $rdrTT = $cmdTT.ExecuteReader()
    $cols = 0..($rdrTT.FieldCount - 1) | ForEach-Object { $rdrTT.GetName($_) }
    $rdrTT.Close()
    Write-Host "Columnas en TimeTable: $($cols -join ', ')"

    $cmdAllTT = $conn.CreateCommand()
    $cmdAllTT.CommandText = "SELECT TOP 20 * FROM TimeTable"
    $rdrAllTT = $cmdAllTT.ExecuteReader()
    $ttList = @()
    while ($rdrAllTT.Read()) {
        $obj = [ordered]@{}
        foreach ($c in $cols) {
            $obj[$c] = $rdrAllTT[$c]
        }
        $ttList += [PSCustomObject]$obj
    }
    $rdrAllTT.Close()
    $ttList | Format-Table -AutoSize
} catch {
    Write-Host "Error al leer TimeTable: $_" -ForegroundColor Red
}

# 8. INTEGRIDAD REFERENCIAL Y ANOMALIAS
Write-Host "`n--- 8. INTEGRIDAD Y CONTROL DE ANOMALIAS ---" -ForegroundColor Yellow

# Userids en fichadas sin registro en Userinfo
$cmdOrphan = $conn.CreateCommand()
$cmdOrphan.CommandText = "SELECT COUNT(*) FROM (SELECT DISTINCT c.Userid FROM CHECKINOUT c LEFT JOIN Userinfo u ON c.Userid = u.Userid WHERE u.Userid IS NULL)"
$orphanUsers = $cmdOrphan.ExecuteScalar()
Write-Host "Usuarios con Fichadas pero Inexistentes en Userinfo: $orphanUsers"

# Fichadas con fechas anómalas (fuera del rango operativo 2020 - 2027)
$cmdBadDates = $conn.CreateCommand()
$cmdBadDates.CommandText = "SELECT COUNT(*) FROM CHECKINOUT WHERE CheckTime < #2020-01-01# OR CheckTime > #2027-01-01#"
$badDates = $cmdBadDates.ExecuteScalar()
Write-Host "Fichadas con Fechas Descalibradas (<2020 o >2027): $badDates"

# Empleados sin departamento asignado
$cmdNoDept = $conn.CreateCommand()
$cmdNoDept.CommandText = "SELECT COUNT(*) FROM Userinfo WHERE Deptid IS NULL"
$noDeptCount = $cmdNoDept.ExecuteScalar()
Write-Host "Empleados sin departamento asignado (Deptid IS NULL): $noDeptCount"

$conn.Close()
Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
Write-Host "`nAnálisis de base de datos finalizado con éxito." -ForegroundColor Green
