$replicaDir = "C:\CrossChex_Replicas"
$replicaPath = "$replicaDir\CrossChex_Local.mdb"
$originalPath = $env:ORIGINAL_MDB_PATH
$tempPath = "$replicaDir\CrossChex_Exp_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

if (!(Test-Path $replicaDir)) { New-Item -ItemType Directory -Path $replicaDir -Force | Out-Null }

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

    $outputDir = "C:\Users\AnalistaIT\.gemini\antigravity-ide\scratch\control-acceso-crosschex\backend\data"
    if (!(Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }

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

    Write-Host "Exportando Marcaciones..."
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $cmdCheck = $conn.CreateCommand()
    $cmdCheck.CommandText = "SELECT C.Logid, C.userid, C.CheckTime, C.Sensorid, C.temperature FROM Checkinout AS C ORDER BY C.CheckTime DESC"
    $adapterCheck = New-Object System.Data.OleDb.OleDbDataAdapter($cmdCheck)
    $dtCheck = New-Object System.Data.DataTable
    $adapterCheck.Fill($dtCheck) | Out-Null
    $conn.Close()
    $sw.Stop()

    Write-Host "Carga en memoria finalizada en $($sw.Elapsed.TotalSeconds) segundos. Escribiendo CSV de marcaciones..."
    $swWrite = [System.Diagnostics.Stopwatch]::StartNew()

    $csvTmpPath = "$outputDir\checkinout.csv.tmp"
    $writer = New-Object System.IO.StreamWriter($csvTmpPath, $false, [System.Text.Encoding]::UTF8)
    $writer.WriteLine("Logid,userid,CheckTime,Sensorid,temperature")

    foreach ($row in $dtCheck.Rows) {
        $logid = $row["Logid"]
        $uid = $row["userid"]
        $ctime = $row["CheckTime"].ToString("yyyy-MM-dd HH:mm:ss")
        $sensor = $row["Sensorid"]
        $temp = $row["temperature"]
        $writer.WriteLine("$logid,$uid,$ctime,$sensor,$temp")
    }
    $writer.Close()
    if (Test-Path "$outputDir\checkinout.csv") { Remove-Item "$outputDir\checkinout.csv" -Force }
    Move-Item $csvTmpPath "$outputDir\checkinout.csv" -Force
    $swWrite.Stop()

    Write-Host "Exportación completada exitosamente!"
} finally {
    if ($conn -and $conn.State -eq [System.Data.ConnectionState]::Open) {
        $conn.Close()
    }
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}
