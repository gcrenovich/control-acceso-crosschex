$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$tempPath = "$env:TEMP\temp_crosschex_inspect_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

$srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$dstStream = New-Object System.IO.FileStream($tempPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$srcStream.CopyTo($dstStream)
$srcStream.Close()
$dstStream.Close()

try {
    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempPath;Persist Security Info=False;")
    $conn.Open()
    $tables = @('UserLeave', 'LeaveClass', 'Z_MemRecord', 'Z_MemAbnor', 'Status', 'StatItems', 'Checkinout', 'TimeTable', 'Schedule', 'SchTime', 'UserShift', 'UserTempShift', 'Holiday', 'd_day', 'd_month')
    foreach ($tbl in $tables) {
        Write-Host "=== TABLE: $tbl ==="
        try {
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "SELECT TOP 1 * FROM [$tbl]"
            $reader = $cmd.ExecuteReader([System.Data.CommandBehavior]::SchemaOnly)
            $st = $reader.GetSchemaTable()
            $cols = @()
            foreach ($row in $st.Rows) {
                $cols += "$($row['ColumnName']) ($($row['DataType'].Name))"
            }
            Write-Host "   Cols: $($cols -join ', ')"
            $reader.Close()
            
            $cmdCount = $conn.CreateCommand()
            $cmdCount.CommandText = "SELECT COUNT(*) FROM [$tbl]"
            $cnt = $cmdCount.ExecuteScalar()
            Write-Host "   Total Rows: $cnt"
        } catch {
            Write-Host "   Error: $_"
        }
    }
    $conn.Close()
} finally {
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}
