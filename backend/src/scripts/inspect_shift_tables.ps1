$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$dst = "C:\CrossChex_Replicas\CrossChex_TempCopy.mdb"

# Copy using FileShare.ReadWrite so locked files can be read
$srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$dstStream = New-Object System.IO.FileStream($dst, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$srcStream.CopyTo($dstStream)
$srcStream.Close()
$dstStream.Close()

Write-Host "Copia realizada con éxito a $dst"

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$dst;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
try {
    $conn.Open()
    Write-Host "Conectado a $dst"

    function Export-TableSample($tableName) {
        Write-Host "=== TABLA: ${tableName} ==="
        try {
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "SELECT TOP 10 * FROM ${tableName}"
            $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
            $dt = New-Object System.Data.DataTable
            $adapter.Fill($dt) | Out-Null
            $dt | ConvertTo-Json -Depth 3 | Write-Host
        } catch {
            Write-Host "Error leyendo ${tableName}: $_"
        }
    }

    Export-TableSample "TimeTable"
    Export-TableSample "UserShift"
    Export-TableSample "Schedule"
    Export-TableSample "SchTime"
    Export-TableSample "UserTempShift"
} catch {
    Write-Host "Error al abrir DB: $_"
} finally {
    if ($conn.State -eq [System.Data.ConnectionState]::Open) {
        $conn.Close()
    }
    Remove-Item $dst -Force -ErrorAction SilentlyContinue
}
