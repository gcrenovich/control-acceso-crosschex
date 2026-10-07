$originalPath = "\\10.0.0.89\CrossChex Standard\DB\CrossChex.mdb"
$replicaPath = "C:\CrossChex_Replicas\CrossChex_Local.mdb"

if (Test-Path $originalPath) {
    Write-Host "Leyendo directamente desde $originalPath"
    $dbPath = $originalPath
} else {
    Write-Host "Leyendo desde $replicaPath"
    $dbPath = $replicaPath
}

# Copy to temp file using CMD copy (which handles shared files better)
$tempDb = "C:\CrossChex_Replicas\CrossChex_Inspect.mdb"
cmd /c copy /y "$dbPath" "$tempDb" > $null

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

function Get-CleanTable($tableName) {
    Write-Host "================== TABLA: $tableName =================="
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT TOP 10 * FROM $tableName"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    
    $list = @()
    foreach ($row in $dt.Rows) {
        $obj = [ordered]@{}
        foreach ($col in $dt.Columns) {
            $val = $row[$col.ColumnName]
            if ($val -is [DateTime]) {
                $obj[$col.ColumnName] = $val.ToString("yyyy-MM-dd HH:mm:ss")
            } else {
                $obj[$col.ColumnName] = $val
            }
        }
        $list += $obj
    }
    $list | ConvertTo-Json -Depth 2
}

Get-CleanTable "TimeTable"
Get-CleanTable "Schedule"
Get-CleanTable "SchTime"
Get-CleanTable "UserShift"
Get-CleanTable "UserTempShift"

$conn.Close()
Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
