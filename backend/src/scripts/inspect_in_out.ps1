$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$tempDb = "$env:TEMP\temp_inspect_in_out_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

$srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$dstStream = New-Object System.IO.FileStream($tempDb, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$srcStream.CopyTo($dstStream)
$srcStream.Close()
$dstStream.Close()

try {
    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;")
    $conn.Open()

    Write-Host "=== TABLA FingerClient (Dispositivos / Sensores) ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT * FROM FingerClient"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    Write-Host "=== TABLA Status ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT * FROM Status"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    Write-Host "=== VALORES DISTINTOS DE CheckType EN Checkinout ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT CheckType, COUNT(*) as Cantidad FROM Checkinout GROUP BY CheckType"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    Write-Host "=== VALORES DISTINTOS DE Sensorid EN Checkinout ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT Sensorid, COUNT(*) as Cantidad FROM Checkinout GROUP BY Sensorid"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    Write-Host "=== MUESTRA DE MARCACIONES CON FECHA RECIENTE (2026) ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT TOP 15 Logid, userid, CheckTime, CheckType, Sensorid, WorkType, AttFlag, OpenDoorFlag FROM Checkinout WHERE CheckTime >= #2026-10-01# ORDER BY CheckTime DESC"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    Write-Host "=== MUESTRA DE TimeTable ==="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT * FROM TimeTable"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize

    $conn.Close()
    $conn.Dispose()
} finally {
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
    $ldb = [System.IO.Path]::ChangeExtension($tempDb, ".ldb")
    Remove-Item $ldb -Force -ErrorAction SilentlyContinue
}
