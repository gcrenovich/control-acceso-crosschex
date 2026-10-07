$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$dst = "C:\CrossChex_Replicas\CrossChex_Inspect.mdb"

cmd /c copy /y "$src" "$dst" > $null

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$dst;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT Timeid, Timename, Intime, Outtime, BIntime, EIntime, BOuttime, EOuttime, Latetime, Leavetime, Longtime FROM TimeTable"
$adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
$dt = New-Object System.Data.DataTable
$adapter.Fill($dt) | Out-Null

$list = @()
foreach ($row in $dt.Rows) {
    $obj = [ordered]@{}
    foreach ($col in $dt.Columns) {
        $obj[$col.ColumnName] = $row[$col.ColumnName]
    }
    $list += $obj
}

$list | ConvertTo-Json -Depth 2 | Out-File -FilePath "c:\Users\AnalistaIT\.gemini\antigravity-ide\scratch\control-acceso-crosschex\backend\data\timetables.json" -Encoding utf8
Write-Host "TimeTable exportado con $($list.Count) horarios."

$conn.Close()
Remove-Item $dst -Force -ErrorAction SilentlyContinue
