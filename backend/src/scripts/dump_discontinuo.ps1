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

$tempDb = "$env:TEMP\analyze_disc_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"
if (-not (Copy-SharedFile $dbPath $tempDb)) { exit 1 }

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

Write-Host "=== TURNOS DISCONTINUOS (HORARIOS CORTADOS) EN SCHTIME ===" -ForegroundColor Cyan
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT st.Schid, s.Schname, st.BeginDay, st.Timeid, t.Timename, t.Intime, t.Outtime FROM (SchTime st INNER JOIN Schedule s ON st.Schid = s.Schid) INNER JOIN TimeTable t ON st.Timeid = t.Timeid WHERE s.Schname LIKE '%discontinuo%' OR s.Schname LIKE '%deposito%' OR s.Schname LIKE '%empleado%' ORDER BY st.Schid, st.BeginDay, t.Intime"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        Schid = $rdr['Schid']
        Ciclo = $rdr['Schname']
        Dia = $rdr['BeginDay']
        Timeid = $rdr['Timeid']
        Turno = $rdr['Timename']
        Entrada = $rdr['Intime']
        Salida = $rdr['Outtime']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "=== TODOS LOS TURNOS QUE TIENEN SALIDA 12:00 O ENTRADA 14:00 O ENTRADA 07:00 U 08:00 ===" -ForegroundColor Cyan
$cmd2 = $conn.CreateCommand()
$cmd2.CommandText = "SELECT Timeid, Timename, Intime, Outtime, Latetime, Leavetime FROM TimeTable WHERE Intime IN ('07:00','07:30','08:00','13:00','14:00','15:00','21:00') OR Outtime IN ('12:00','12:30','13:00','17:00','18:00','05:00') ORDER BY Intime, Outtime"
$rdr2 = $cmd2.ExecuteReader()
$list2 = @()
while ($rdr2.Read()) {
    $list2 += [PSCustomObject]@{
        ID = $rdr2['Timeid']
        Nombre = $rdr2['Timename']
        Entrada = $rdr2['Intime']
        Salida = $rdr2['Outtime']
        TolTarde = $rdr2['Latetime']
        TolSalida = $rdr2['Leavetime']
    }
}
$rdr2.Close()
$list2 | Format-Table -AutoSize

$conn.Close()
Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
