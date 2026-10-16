$ErrorActionPreference = "Stop"
$dbPath = "C:\CrossChex_Replicas\CrossChex_Local.mdb"

function Copy-SharedFile($src, $dst) {
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            $srcStream = New-Object System.IO.FileStream($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $dstStream = New-Object System.IO.FileStream($dst, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $srcStream.CopyTo($dstStream)
            $srcStream.Close()
            $dstStream.Close()
            return $true
        } catch {
            Write-Host "Intento $attempt fallo: $($_.Exception.Message)"
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

$tempDb = "$env:TEMP\analyze_shifts_$([guid]::NewGuid().ToString().Substring(0,8)).mdb"
if (-not (Copy-SharedFile $dbPath $tempDb)) {
    Write-Host "No se pudo copiar MDB"
    exit 1
}

$connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$tempDb;Persist Security Info=False;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()

function Dump-Table($tableName, $topCount=15) {
    Write-Host "`n========================================================" -ForegroundColor Cyan
    Write-Host "  TABLA: $tableName" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Cyan
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "SELECT TOP $topCount * FROM [$tableName]"
        $rdr = $cmd.ExecuteReader()
        $cols = 0..($rdr.FieldCount - 1) | ForEach-Object { $rdr.GetName($_) }
        Write-Host "Columnas ($($cols.Count)): $($cols -join ', ')" -ForegroundColor Yellow
        $rows = @()
        while ($rdr.Read()) {
            $obj = [ordered]@{}
            foreach ($c in $cols) {
                $obj[$c] = $rdr[$c]
            }
            $rows += [PSCustomObject]$obj
        }
        $rdr.Close()
        if ($rows.Count -gt 0) {
            $rows | Format-Table -AutoSize
        } else {
            Write-Host "Tabla vacia."
        }
    } catch {
        Write-Host "Error al leer $tableName : $_" -ForegroundColor Red
    }
}

Dump-Table "Schedule" 25
Dump-Table "SchTime" 25
Dump-Table "TimeTable" 88
Dump-Table "UserShift" 15
Dump-Table "UserTempShift" 15

$conn.Close()
Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
