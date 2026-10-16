$ErrorActionPreference = "Stop"
$dbPath = "C:\CrossChex_Replicas\CrossChex_Local.mdb"

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
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

$tempDb = "$env:TEMP\analyze_shifts_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"
if (-not (Copy-SharedFile $dbPath $tempDb)) {
    Write-Host "No se pudo copiar MDB"
    exit 1
}

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

Write-Host "=== 1. TABLA SCHEDULE (CICLOS Y TURNOS PRINCIPALES) ==="
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP 40 Schid, Schname, CycleNum, CycleUnit FROM Schedule ORDER BY Schid"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        Schid = $rdr['Schid']
        Schname = $rdr['Schname']
        CycleNum = $rdr['CycleNum']
        CycleUnit = $rdr['CycleUnit']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "=== 2. TABLA SCHTIME (RELACION CICLO Y TURNOS TIMETABLE) ==="
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP 50 Schid, DayNum, Timeid FROM SchTime ORDER BY Schid, DayNum"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        Schid = $rdr['Schid']
        DayNum = $rdr['DayNum']
        Timeid = $rdr['Timeid']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "=== 3. TABLA TIMETABLE COMPLETA (TURNOS DEFINIDOS) ==="
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT Timeid, Timename, Intime, Outtime, BIntime, EIntime, BOuttime, EOuttime, Latetime, Leavetime FROM TimeTable ORDER BY Timeid"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        ID = $rdr['Timeid']
        Nombre = $rdr['Timename']
        Entrada = $rdr['Intime']
        Salida = $rdr['Outtime']
        BIn = $rdr['BIntime']
        EIn = $rdr['EIntime']
        BOut = $rdr['BOuttime']
        EOut = $rdr['EOuttime']
        TolTarde = $rdr['Latetime']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "=== 4. ASIGNACION DE TURNOS A EMPLEADOS (USERSHIFT) ==="
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP 20 Userid, Schid, SDate, EDate FROM UserShift ORDER BY Userid"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        Userid = $rdr['Userid']
        Schid = $rdr['Schid']
        SDate = $rdr['SDate']
        EDate = $rdr['EDate']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "Distribucion de empleados por Schedule:"
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT s.Schid, s.Schname, COUNT(u.Userid) as CantidadEmpleados FROM Schedule s INNER JOIN UserShift u ON s.Schid = u.Schid GROUP BY s.Schid, s.Schname ORDER BY COUNT(u.Userid) DESC"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        SchID = $rdr['Schid']
        NombreCiclo = $rdr['Schname']
        EmpleadosAsignados = $rdr['CantidadEmpleados']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "=== 5. MODIFICACIONES TEMPORALES DE TURNOS (USERTEMPSHIFT) ==="
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP 20 Userid, WorkDate, Timeid FROM UserTempShift ORDER BY WorkDate DESC"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        Userid = $rdr['Userid']
        WorkDate = $rdr['WorkDate']
        Timeid = $rdr['Timeid']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

$conn.Close()
Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
