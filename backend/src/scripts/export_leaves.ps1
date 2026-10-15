$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$tempPath = "$env:TEMP\temp_crosschex_exp_leaves_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"
$outputDir = "c:\Users\AnalistaIT\.gemini\antigravity-ide\scratch\control-acceso-crosschex\backend\data"

$srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$dstStream = New-Object System.IO.FileStream($tempPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$srcStream.CopyTo($dstStream)
$srcStream.Close()
$dstStream.Close()

try {
    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempPath;Persist Security Info=False;")
    $conn.Open()

    Write-Host "Exportando LeaveClass..."
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
    [System.IO.File]::WriteAllText("$outputDir\leave_classes.json", $lcJson, [System.Text.Encoding]::UTF8)
    Write-Host "LeaveClass exportado: $($lcList.Count) clases."

    Write-Host "Exportando UserLeave..."
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
    [System.IO.File]::WriteAllText("$outputDir\user_leaves.json", $ulJson, [System.Text.Encoding]::UTF8)
    Write-Host "UserLeave exportado: $($ulList.Count) registros de permisos/excepciones."

    $conn.Close()
} finally {
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}
