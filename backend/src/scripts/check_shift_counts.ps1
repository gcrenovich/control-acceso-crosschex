$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$dst = "C:\CrossChex_Replicas\CrossChex_ExportTest.mdb"

cmd /c copy /y "$src" "$dst" > $null

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$dst;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

function Export-TableCount($tableName) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT COUNT(*) FROM $tableName"
    $count = $cmd.ExecuteScalar()
    Write-Host "Tabla $tableName : $count filas."
}

Export-TableCount "TimeTable"
Export-TableCount "UserTempShift"
Export-TableCount "UserShift"
Export-TableCount "Schedule"
Export-TableCount "SchTime"

$conn.Close()
Remove-Item $dst -Force -ErrorAction SilentlyContinue
