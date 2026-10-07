$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\CrossChex_Replicas\CrossChex_Local.mdb;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()
$tables = $conn.GetSchema("Tables")
$tables | Where-Object { $_.TABLE_TYPE -eq 'TABLE' } | Select-Object TABLE_NAME | Format-Table -AutoSize
$conn.Close()
