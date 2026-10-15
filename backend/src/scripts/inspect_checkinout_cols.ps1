$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\CrossChex_Replicas\CrossChex_Local.mdb;")
$conn.Open()

Write-Host "=== COLUMNAS DE Checkinout ==="
$schemaCols = $conn.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Columns, @($null, $null, "Checkinout", $null))
$schemaCols | Select-Object COLUMN_NAME, DATA_TYPE | Format-Table -AutoSize

Write-Host "=== MUESTRA DE 5 FILAS DE Checkinout ==="
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP 5 * FROM Checkinout ORDER BY CheckTime DESC"
$adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
$dt = New-Object System.Data.DataTable
$adapter.Fill($dt) | Out-Null
$dt | Format-Table -AutoSize

Write-Host "=== TABLAS EN LA BASE DE DATOS ==="
$tables = $conn.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables, @($null, $null, $null, "TABLE"))
$tables | Select-Object TABLE_NAME | Format-Table -AutoSize

$conn.Close()
