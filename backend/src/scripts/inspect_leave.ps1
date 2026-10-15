$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$tempPath = "$env:TEMP\temp_crosschex_leave_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

$srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$dstStream = New-Object System.IO.FileStream($tempPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$srcStream.CopyTo($dstStream)
$srcStream.Close()
$dstStream.Close()

try {
    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempPath;Persist Security Info=False;")
    $conn.Open()
    
    Write-Host "=== LEAVECLASS ==="
    $cmdLC = $conn.CreateCommand()
    $cmdLC.CommandText = "SELECT * FROM LeaveClass"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmdLC)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $dt | Format-Table -AutoSize
    
    Write-Host "=== USERLEAVE (TOP 10) ==="
    $cmdUL = $conn.CreateCommand()
    $cmdUL.CommandText = "SELECT TOP 10 L.Lsh, L.userid, U.UserCode, U.Name, L.BeginTime, L.EndTime, L.LeaveClassid, LC.Classname, L.Whys FROM (UserLeave AS L LEFT JOIN LeaveClass AS LC ON L.LeaveClassid = LC.Classid) LEFT JOIN Userinfo AS U ON L.userid = U.userid ORDER BY L.BeginTime DESC"
    $adapterUL = New-Object System.Data.OleDb.OleDbDataAdapter($cmdUL)
    $dtUL = New-Object System.Data.DataTable
    $adapterUL.Fill($dtUL) | Out-Null
    $dtUL | Format-Table -AutoSize

    $conn.Close()
} finally {
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}
