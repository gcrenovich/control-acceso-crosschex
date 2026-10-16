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

$tempDb = "$env:TEMP\analyze_sch_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"
if (-not (Copy-SharedFile $dbPath $tempDb)) { exit 1 }

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

Write-Host "=== TABLA SCHEDULE ===" -ForegroundColor Cyan
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP 30 * FROM Schedule"
$rdr = $cmd.ExecuteReader()
$cols = 0..($rdr.FieldCount - 1) | ForEach-Object { $rdr.GetName($_) }
Write-Host "Cols: $($cols -join ', ')"
$list = @()
while ($rdr.Read()) {
    $obj = [ordered]@{}
    foreach ($c in $cols) { $obj[$c] = $rdr[$c] }
    $list += [PSCustomObject]$obj
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "=== TABLA SCHTIME (PRIMEROS 40 REGISTROS) ===" -ForegroundColor Cyan
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP 40 * FROM SchTime"
$rdr = $cmd.ExecuteReader()
$cols = 0..($rdr.FieldCount - 1) | ForEach-Object { $rdr.GetName($_) }
Write-Host "Cols: $($cols -join ', ')"
$list = @()
while ($rdr.Read()) {
    $obj = [ordered]@{}
    foreach ($c in $cols) { $obj[$c] = $rdr[$c] }
    $list += [PSCustomObject]$obj
}
$rdr.Close()
$list | Format-Table -AutoSize

Write-Host "=== DETALLE DE CRONOGRAMA 1 (SCHID = 1) CON TURNOS ===" -ForegroundColor Cyan
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT st.Schid, s.Schname, st.DayNum, st.Timeid, t.Timename, t.Intime, t.Outtime FROM ((SchTime st INNER JOIN Schedule s ON st.Schid = s.Schid) INNER JOIN TimeTable t ON st.Timeid = t.Timeid) WHERE st.Schid IN (1, 4, 8, 13, 17) ORDER BY st.Schid, st.DayNum"
$rdr = $cmd.ExecuteReader()
$list = @()
while ($rdr.Read()) {
    $list += [PSCustomObject]@{
        Schid = $rdr['Schid']
        Ciclo = $rdr['Schname']
        DiaNum = $rdr['DayNum']
        Turno = $rdr['Timename']
        Entrada = $rdr['Intime']
        Salida = $rdr['Outtime']
    }
}
$rdr.Close()
$list | Format-Table -AutoSize

$conn.Close()
Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
