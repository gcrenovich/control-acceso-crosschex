$src = "C:\CrossChex_Replicas\CrossChex_Local.mdb"
$tempPath = "$env:TEMP\temp_crosschex_holidays_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"

$copied = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $dstStream = New-Object System.IO.FileStream($tempPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $srcStream.CopyTo($dstStream)
        $srcStream.Close()
        $dstStream.Close()
        $copied = $true
        break
    } catch {
        Start-Sleep -Milliseconds 800
    }
}
if (!$copied) {
    Write-Host "No se pudo copiar $src tras varios intentos"
    exit 1
}

try {
    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempPath;Persist Security Info=False;")
    $conn.Open()
    
    # 1. Inspeccionar tabla Holiday si existe
    Write-Host "=== TABLA Holiday ==="
    try {
        $cmdH = $conn.CreateCommand()
        $cmdH.CommandText = "SELECT * FROM Holiday"
        $adapterH = New-Object System.Data.OleDb.OleDbDataAdapter($cmdH)
        $dtH = New-Object System.Data.DataTable
        $adapterH.Fill($dtH) | Out-Null
        Write-Host "Holiday rows: $($dtH.Rows.Count)"
        $dtH | Format-Table -AutoSize | Out-String | Write-Host
    } catch {
        Write-Host "Error en Holiday: $_"
    }

    # 2. Inspeccionar tablas del esquema
    Write-Host "=== TODAS LAS TABLAS EN MDB ==="
    $schemaTables = $conn.GetSchema("Tables")
    foreach ($row in $schemaTables.Rows) {
        if ($row["TABLE_TYPE"] -eq "TABLE") {
            Write-Host "Table: $($row['TABLE_NAME'])"
        }
    }

    Write-Host "=== Z_MemAbnor para 9851 y 9854 ==="
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "SELECT * FROM Z_MemAbnor WHERE uid IN ('9851', '9854') ORDER BY BeginTime"
        $ad = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
        $dt = New-Object System.Data.DataTable
        $ad.Fill($dt) | Out-Null
        $dt | Format-Table -AutoSize | Out-String | Write-Host
    } catch {
        Write-Host "Error Z_MemAbnor: $_"
    }

    Write-Host "=== Z_MemRecord para 9851 y 9854 ==="
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "SELECT * FROM Z_MemRecord WHERE uid IN ('9851', '9854') ORDER BY Checktime DESC"
        $ad = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
        $dt = New-Object System.Data.DataTable
        $ad.Fill($dt) | Out-Null
        $dt | Format-Table -AutoSize | Out-String | Write-Host
    } catch {
        Write-Host "Error Z_MemRecord: $_"
    }

    Write-Host "=== MemStat Schema Columns ==="
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "SELECT TOP 1 * FROM MemStat"
        $reader = $cmd.ExecuteReader([System.Data.CommandBehavior]::SchemaOnly)
        $st = $reader.GetSchemaTable()
        foreach ($row in $st.Rows) {
            Write-Host "$($row['ColumnName']) : $($row['DataType'].Name)"
        }
        $reader.Close()
    } catch {
        Write-Host "Error schema: $_"
    }

    $conn.Close()
} finally {
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}
