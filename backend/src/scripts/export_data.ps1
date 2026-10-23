$replicaDir = "C:\CrossChex_Replicas"
$replicaPath = "$replicaDir\CrossChex_Local.mdb"
$originalPath = $env:ORIGINAL_MDB_PATH
$tempPath = "$env:TEMP\temp_crosschex_exp_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

if (!(Test-Path $replicaDir)) { New-Item -ItemType Directory -Path $replicaDir -Force | Out-Null }

# Limpieza preventiva de archivos temporales huérfanos
Get-ChildItem -Path $replicaDir -Filter "CrossChex_Exp_*" -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
}

# 1. Asegurar sesión SMB activa con la PC del CrossChex si es ruta UNC
if (![string]::IsNullOrWhiteSpace($originalPath) -and $originalPath.StartsWith("\\")) {
    $serverName = $originalPath.Split("\")[2]
    & net use "\\$serverName" /persistent:yes 2>$null | Out-Null
}

function Copy-SharedFile($src, $dst) {
    try {
        $srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $dstStream = New-Object System.IO.FileStream($dst, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $srcStream.CopyTo($dstStream)
        $srcStream.Close()
        $dstStream.Close()
        return $true
    } catch {
        Write-Host "Error al copiar $src a $dst : $_"
        return $false
    }
}

$sourceToUse = $replicaPath

if (![string]::IsNullOrWhiteSpace($originalPath) -and (Test-Path $originalPath)) {
    Write-Host "Intentando actualizar réplica desde base original..."
    if (Copy-SharedFile $originalPath $replicaPath) {
        Write-Host "Réplica actualizada desde original."
        $sourceToUse = $originalPath
    } else {
        Write-Host "Usando réplica existente."
    }
} else {
    Write-Host "Usando réplica existente en $replicaPath"
}

# 2. Verificación de optimización: evitar re-exportar 1 millón de filas si la base no ha cambiado
$outputDir = "C:\Users\AnalistaIT\.gemini\antigravity-ide\scratch\control-acceso-crosschex\backend\data"
if (!(Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
$lastSyncTokenFile = "$outputDir\.last_sync_token"

$sourceInfo = Get-Item $sourceToUse -ErrorAction SilentlyContinue
if ($sourceInfo -and (Test-Path "$outputDir\checkinout.csv") -and (Test-Path $lastSyncTokenFile)) {
    $lastToken = (Get-Content $lastSyncTokenFile -Raw -ErrorAction SilentlyContinue)
    $currentToken = "$($sourceInfo.LastWriteTime.Ticks)_$($sourceInfo.Length)"
    if ($lastToken -and $lastToken.Trim() -eq $currentToken) {
        Write-Host "Base de datos sin modificaciones desde última exportación ($($sourceInfo.LastWriteTime)). Exportación omitida por optimización."
        exit 0
    }
}

Write-Host "Creando copia de trabajo segura en $tempPath ..."
$copied = Copy-SharedFile $sourceToUse $tempPath

if (!(Test-Path $tempPath)) {
    Write-Host "CRÍTICO: No se pudo crear la copia de trabajo $tempPath"
    exit 1
}

try {
    $connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempPath;Persist Security Info=False;"
    $conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
    $conn.Open()

    Write-Host "Exportando Departamentos..."
    $cmdDept = $conn.CreateCommand()
    $cmdDept.CommandText = "SELECT * FROM Dept"
    $adapterDept = New-Object System.Data.OleDb.OleDbDataAdapter($cmdDept)
    $dtDept = New-Object System.Data.DataTable
    $adapterDept.Fill($dtDept) | Out-Null
    $deptJson = $dtDept | ConvertTo-Json
    [System.IO.File]::WriteAllText("$outputDir\departments.json.tmp", $deptJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\departments.json") { Remove-Item "$outputDir\departments.json" -Force }
    Move-Item "$outputDir\departments.json.tmp" "$outputDir\departments.json" -Force

    Write-Host "Exportando Usuarios..."
    $cmdUser = $conn.CreateCommand()
    $cmdUser.CommandText = "SELECT userid, UserCode, Name, Cardnum, Deptid FROM Userinfo"
    $adapterUser = New-Object System.Data.OleDb.OleDbDataAdapter($cmdUser)
    $dtUser = New-Object System.Data.DataTable
    $adapterUser.Fill($dtUser) | Out-Null
    $userJson = $dtUser | ConvertTo-Json
    [System.IO.File]::WriteAllText("$outputDir\users.json.tmp", $userJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\users.json") { Remove-Item "$outputDir\users.json" -Force }
    Move-Item "$outputDir\users.json.tmp" "$outputDir\users.json" -Force

    Write-Host "Exportando Horarios (TimeTable)..."
    $cmdTT = $conn.CreateCommand()
    $cmdTT.CommandText = "SELECT Timeid, Timename, Intime, Outtime, BIntime, EIntime, BOuttime, EOuttime, Latetime, Leavetime, Longtime, MustIn, MustOut FROM TimeTable"
    $adapterTT = New-Object System.Data.OleDb.OleDbDataAdapter($cmdTT)
    $dtTT = New-Object System.Data.DataTable
    $adapterTT.Fill($dtTT) | Out-Null
    $ttList = @()
    foreach ($row in $dtTT.Rows) {
        $obj = [ordered]@{}
        foreach ($col in $dtTT.Columns) {
            $obj[$col.ColumnName] = $row[$col.ColumnName]
        }
        $ttList += $obj
    }
    $ttJson = $ttList | ConvertTo-Json -Depth 2
    [System.IO.File]::WriteAllText("$outputDir\timetables.json.tmp", $ttJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\timetables.json") { Remove-Item "$outputDir\timetables.json" -Force }
    Move-Item "$outputDir\timetables.json.tmp" "$outputDir\timetables.json" -Force

    Write-Host "Exportando Horarios General (Schedule, SchTime, UserShift)..."
    $cmdSch = $conn.CreateCommand()
    $cmdSch.CommandText = "SELECT Schid, Schname, Cycles, Units, IsDefault FROM Schedule"
    $adapterSch = New-Object System.Data.OleDb.OleDbDataAdapter($cmdSch)
    $dtSch = New-Object System.Data.DataTable
    $adapterSch.Fill($dtSch) | Out-Null
    $schJson = $dtSch | ConvertTo-Json
    [System.IO.File]::WriteAllText("$outputDir\schedules.json.tmp", $schJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\schedules.json") { Remove-Item "$outputDir\schedules.json" -Force }
    Move-Item "$outputDir\schedules.json.tmp" "$outputDir\schedules.json" -Force

    $cmdST = $conn.CreateCommand()
    $cmdST.CommandText = "SELECT Schid, BeginDay, Timeid FROM SchTime"
    $adapterST = New-Object System.Data.OleDb.OleDbDataAdapter($cmdST)
    $dtST = New-Object System.Data.DataTable
    $adapterST.Fill($dtST) | Out-Null
    $stJson = $dtST | ConvertTo-Json
    [System.IO.File]::WriteAllText("$outputDir\sch_times.json.tmp", $stJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\sch_times.json") { Remove-Item "$outputDir\sch_times.json" -Force }
    Move-Item "$outputDir\sch_times.json.tmp" "$outputDir\sch_times.json" -Force

    $cmdUS = $conn.CreateCommand()
    $cmdUS.CommandText = "SELECT userid, Schid, BeginDate, EndDate FROM UserShift"
    $adapterUS = New-Object System.Data.OleDb.OleDbDataAdapter($cmdUS)
    $dtUS = New-Object System.Data.DataTable
    $adapterUS.Fill($dtUS) | Out-Null
    $usList = @()
    foreach ($row in $dtUS.Rows) {
        $obj = [ordered]@{}
        $obj["userid"] = $row["userid"]
        $obj["Schid"] = $row["Schid"]
        $obj["BeginDate"] = if ($row["BeginDate"] -is [DateTime]) { $row["BeginDate"].ToString("yyyy-MM-dd") } else { $row["BeginDate"] }
        $obj["EndDate"] = if ($row["EndDate"] -is [DateTime]) { $row["EndDate"].ToString("yyyy-MM-dd") } else { $row["EndDate"] }
        $usList += $obj
    }
    $usJson = $usList | ConvertTo-Json -Depth 2
    [System.IO.File]::WriteAllText("$outputDir\user_shifts.json.tmp", $usJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\user_shifts.json") { Remove-Item "$outputDir\user_shifts.json" -Force }
    Move-Item "$outputDir\user_shifts.json.tmp" "$outputDir\user_shifts.json" -Force

    Write-Host "Exportando Turnos Diarios de Usuarios (UserTempShift)..."
    $cmdUTS = $conn.CreateCommand()
    $cmdUTS.CommandText = "SELECT userid, Timeid, WorkDate FROM UserTempShift"
    $adapterUTS = New-Object System.Data.OleDb.OleDbDataAdapter($cmdUTS)
    $dtUTS = New-Object System.Data.DataTable
    $adapterUTS.Fill($dtUTS) | Out-Null

    $utsTmpPath = "$outputDir\user_temp_shifts.csv.tmp"
    $utsWriter = New-Object System.IO.StreamWriter($utsTmpPath, $false, [System.Text.Encoding]::UTF8)
    $utsWriter.WriteLine("userid,Timeid,WorkDate")
    foreach ($row in $dtUTS.Rows) {
        $uid = $row["userid"]
        $tid = $row["Timeid"]
        $wdate = if ($row["WorkDate"] -is [DateTime]) { $row["WorkDate"].ToString("yyyy-MM-dd") } else { $row["WorkDate"].ToString().Substring(0, 10) }
        $utsWriter.WriteLine("$uid,$tid,$wdate")
    }
    $utsWriter.Close()
    if (Test-Path "$outputDir\user_temp_shifts.csv") { Remove-Item "$outputDir\user_temp_shifts.csv" -Force }
    Move-Item $utsTmpPath "$outputDir\user_temp_shifts.csv" -Force

    Write-Host "Exportando Clases de Excepción (LeaveClass)..."
    $cmdLC = $conn.CreateCommand()
    $cmdLC.CommandText = "SELECT Classid, Classname, ViewColor, Showas, Units, MinUnit, SRControl, IsAddup, IsTimes, IsLeave FROM LeaveClass"
    $adapterLC = New-Object System.Data.OleDb.OleDbDataAdapter($cmdLC)
    $dtLC = New-Object System.Data.DataTable
    $adapterLC.Fill($dtLC) | Out-Null
    $lcList = @()
    foreach ($row in $dtLC.Rows) {
        $obj = [ordered]@{}
        foreach ($col in $dtLC.Columns) {
            $obj[$col.ColumnName] = $row[$col.ColumnName]
        }
        $lcList += $obj
    }
    $lcJson = $lcList | ConvertTo-Json -Depth 2
    [System.IO.File]::WriteAllText("$outputDir\leave_classes.json.tmp", $lcJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\leave_classes.json") { Remove-Item "$outputDir\leave_classes.json" -Force }
    Move-Item "$outputDir\leave_classes.json.tmp" "$outputDir\leave_classes.json" -Force

    Write-Host "Exportando Permisos y Excepciones (UserLeave)..."
    $cmdUL = $conn.CreateCommand()
    $cmdUL.CommandText = "SELECT Lsh, userid, LeaveClassid, BeginTime, EndTime, Whys FROM UserLeave ORDER BY BeginTime DESC"
    $adapterUL = New-Object System.Data.OleDb.OleDbDataAdapter($cmdUL)
    $dtUL = New-Object System.Data.DataTable
    $adapterUL.Fill($dtUL) | Out-Null
    $ulList = @()
    foreach ($row in $dtUL.Rows) {
        $obj = [ordered]@{}
        $obj["Lsh"] = $row["Lsh"]
        $obj["userid"] = $row["userid"]
        $obj["LeaveClassid"] = $row["LeaveClassid"]
        $obj["BeginTime"] = if ($row["BeginTime"] -is [DateTime]) { $row["BeginTime"].ToString("yyyy-MM-dd HH:mm:ss") } else { [string]$row["BeginTime"] }
        $obj["EndTime"] = if ($row["EndTime"] -is [DateTime]) { $row["EndTime"].ToString("yyyy-MM-dd HH:mm:ss") } else { [string]$row["EndTime"] }
        $obj["Whys"] = if ($row["Whys"] -ne [DBNull]::Value) { [string]$row["Whys"] } else { "" }
        $ulList += $obj
    }
    $ulJson = $ulList | ConvertTo-Json -Depth 2
    [System.IO.File]::WriteAllText("$outputDir\user_leaves.json.tmp", $ulJson, [System.Text.Encoding]::UTF8)
    if (Test-Path "$outputDir\user_leaves.json") { Remove-Item "$outputDir\user_leaves.json" -Force }
    Move-Item "$outputDir\user_leaves.json.tmp" "$outputDir\user_leaves.json" -Force

    Write-Host "Exportando Dispositivos/Molinetes (FingerClient)..."
    try {
        $cmdDev = $conn.CreateCommand()
        $cmdDev.CommandText = "SELECT Clientid, ClientNumber, ClientName, ipaddress, RecStatus, Floorid, DeviceType FROM FingerClient"
        $adapterDev = New-Object System.Data.OleDb.OleDbDataAdapter($cmdDev)
        $dtDev = New-Object System.Data.DataTable
        $adapterDev.Fill($dtDev) | Out-Null
        $devList = @()
        foreach ($row in $dtDev.Rows) {
            $obj = [ordered]@{}
            foreach ($col in $dtDev.Columns) {
                $obj[$col.ColumnName] = $row[$col.ColumnName]
            }
            $devList += $obj
        }
        $devJson = $devList | ConvertTo-Json -Depth 2
        [System.IO.File]::WriteAllText("$outputDir\devices.json.tmp", $devJson, [System.Text.Encoding]::UTF8)
        if (Test-Path "$outputDir\devices.json") { Remove-Item "$outputDir\devices.json" -Force }
        Move-Item "$outputDir\devices.json.tmp" "$outputDir\devices.json" -Force
    Write-Host "Exportando Feriados de CrossChex (Holiday)..."
    try {
        $cmdHol = $conn.CreateCommand()
        $cmdHol.CommandText = "SELECT Holidayid, Name, BDate, Days FROM Holiday"
        $adapterHol = New-Object System.Data.OleDb.OleDbDataAdapter($cmdHol)
        $dtHol = New-Object System.Data.DataTable
        $adapterHol.Fill($dtHol) | Out-Null
        $holList = @()
        foreach ($row in $dtHol.Rows) {
            $obj = [ordered]@{}
            $obj["Holidayid"] = $row["Holidayid"]
            $obj["Name"] = $row["Name"]
            $obj["BDate"] = if ($row["BDate"] -is [DateTime]) { $row["BDate"].ToString("yyyy-MM-dd") } else { [string]$row["BDate"] }
            $obj["Days"] = [int]$row["Days"]
            $holList += $obj
        }
        $holJson = $holList | ConvertTo-Json -Depth 2
        [System.IO.File]::WriteAllText("$outputDir\crosschex_holidays.json.tmp", $holJson, [System.Text.Encoding]::UTF8)
        if (Test-Path "$outputDir\crosschex_holidays.json") { Remove-Item "$outputDir\crosschex_holidays.json" -Force }
        Move-Item "$outputDir\crosschex_holidays.json.tmp" "$outputDir\crosschex_holidays.json" -Force
    } catch {
        Write-Host "Nota: No se pudo exportar Holiday: $_"
    }

    Write-Host "Exportando Marcaciones con CheckType (IN/OUT) mediante DataReader de alto rendimiento..."
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $cmdCheck = $conn.CreateCommand()
    $cmdCheck.CommandText = "SELECT C.Logid, C.userid, C.CheckTime, C.CheckType, C.Sensorid, C.temperature FROM Checkinout AS C ORDER BY C.CheckTime DESC"
    $reader = $cmdCheck.ExecuteReader()

    $csvTmpPath = "$outputDir\checkinout.csv.tmp"
    $writer = New-Object System.IO.StreamWriter($csvTmpPath, $false, [System.Text.Encoding]::UTF8)
    $writer.WriteLine("Logid,userid,CheckTime,CheckType,Sensorid,temperature")

    while ($reader.Read()) {
        $logid = $reader.GetValue(0)
        $uid = $reader.GetValue(1)
        $ctimeVal = $reader.GetValue(2)
        $ctime = if ($ctimeVal -is [DateTime]) { $ctimeVal.ToString("yyyy-MM-dd HH:mm:ss") } else { [string]$ctimeVal }
        $ctype = if ($reader.IsDBNull(3)) { 0 } else { $reader.GetValue(3) }
        $sensor = if ($reader.IsDBNull(4)) { 1 } else { $reader.GetValue(4) }
        $temp = if ($reader.IsDBNull(5)) { 0 } else { $reader.GetValue(5) }
        $writer.WriteLine("$logid,$uid,$ctime,$ctype,$sensor,$temp")
    }
    $reader.Close()
    $writer.Close()
    $conn.Close()
    $sw.Stop()

    if (Test-Path "$outputDir\checkinout.csv") { Remove-Item "$outputDir\checkinout.csv" -Force }
    Move-Item $csvTmpPath "$outputDir\checkinout.csv" -Force

    # Guardar token de sincronización para evitar trabajo redundante en próximas iteraciones
    if ($sourceInfo) {
        Set-Content -Path $lastSyncTokenFile -Value "$($sourceInfo.LastWriteTime.Ticks)_$($sourceInfo.Length)" -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Exportación de marcaciones finalizada en $($sw.Elapsed.TotalSeconds) segundos."
    Write-Host "Exportación completada exitosamente!"
} finally {
    if ($conn) {
        if ($conn.State -eq [System.Data.ConnectionState]::Open) {
            $conn.Close()
        }
        $conn.Dispose()
        $conn = $null
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()

    if (Test-Path $tempPath) {
        Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
    }
    $ldbPath = [System.IO.Path]::ChangeExtension($tempPath, ".ldb")
    if (Test-Path $ldbPath) {
        Remove-Item $ldbPath -Force -ErrorAction SilentlyContinue
    }
}
