$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$tempDb = "$env:TEMP\temp_fc_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

$srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$dstStream = New-Object System.IO.FileStream($tempDb, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$srcStream.CopyTo($dstStream)
$srcStream.Close()
$dstStream.Close()

try {
    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;")
    $conn.Open()

    Write-Host "=== TODOS LOS DISPOSITIVOS EN FingerClient ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT Clientid, ClientNumber, ClientName, ipaddress, RecStatus, Floorid, DeviceType FROM FingerClient"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    Write-Host "=== MUESTRA DE CHECKINOUT CON CheckType Y Sensorid RECIENTES ==="
    $cmd.CommandText = "SELECT TOP 20 Logid, userid, CheckTime, CheckType, Sensorid FROM Checkinout ORDER BY CheckTime DESC"
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
