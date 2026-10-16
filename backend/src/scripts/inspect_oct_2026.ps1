$src = "C:\CrossChex_Replicas\CrossChex_2026-10-14_13-00.mdb"
$tempDb = "$env:TEMP\temp_check_2026_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

Copy-Item -Path $src -Destination $tempDb -Force

try {
    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;")
    $conn.Open()

    Write-Host "=== CONTEO DE CheckType EN OCTUBRE 2026 ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT CheckType, Sensorid, COUNT(*) as Total FROM Checkinout WHERE CheckTime >= #2026-10-01# AND CheckTime <= #2026-10-16# GROUP BY CheckType, Sensorid ORDER BY Sensorid, CheckType"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    Write-Host "=== EJEMPLO DE MARCACIONES CONSECUTIVAS (13 AL 14 OCT 2026) ==="
    $cmd.CommandText = "SELECT TOP 40 C.userid, U.Name, C.CheckTime, C.CheckType, C.Sensorid FROM Checkinout C INNER JOIN Userinfo U ON C.userid = U.userid WHERE C.CheckTime >= #2026-10-14 00:00:00# AND C.CheckTime <= #2026-10-14 23:59:59# ORDER BY C.userid, C.CheckTime ASC"
    $dt2 = New-Object System.Data.DataTable
    $adapter.Fill($dt2) | Out-Null
    $dt2 | Format-Table -AutoSize

    $conn.Close()
    $conn.Dispose()
} finally {
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
    $ldb = [System.IO.Path]::ChangeExtension($tempDb, ".ldb")
    Remove-Item $ldb -Force -ErrorAction SilentlyContinue
}
