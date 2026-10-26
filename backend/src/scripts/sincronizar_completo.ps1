# ==============================================================================
# SCRIPT MAESTRO DE SINCRONIZACIÓN - CROSSCHEX (ANVIZ) -> SERVIDOR UBUNTU
# ==============================================================================
# Este script:
# 1. Intenta conectarse a \\10.0.0.89 y actualizar la réplica local de CrossChex.mdb
# 2. Exporta los datos a formato CSV y JSON optimizados
# 3. Transfiere los archivos al servidor Ubuntu 10.0.0.10 vía SFTP
# 4. Notifica al backend de Ubuntu para recargar los datos en memoria en caliente
# ==============================================================================

param (
    [switch]$Force = $false
)

$ErrorActionPreference = "Continue"

$ProjectRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$ReplicaDir = "C:\CrossChex_Replicas"
$ReplicaMdb = "$ReplicaDir\CrossChex_Local.mdb"
$OriginMdb = "\\10.0.0.89\CrossChex Standard\DB\CrossChex.mdb"
$LogFile = "$ReplicaDir\sync_log.txt"

if (-not (Test-Path $ReplicaDir)) {
    New-Item -ItemType Directory -Path $ReplicaDir -Force | Out-Null
}

function Log-Msg {
    param ([string]$Msg, [string]$Color = "White")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Msg"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

Log-Msg "==========================================================" "Cyan"
Log-Msg "Iniciando ciclo de sincronizacion CrossChex..." "Cyan"

# ------------------------------------------------------------------------------
# PASO 1: Replicación desde PC CrossChex (10.0.0.89)
# ------------------------------------------------------------------------------
Log-Msg "[1/3] Verificando conectividad con PC CrossChex (\\10.0.0.89)..." "Yellow"

$huboActualizacionMdb = $false
$origenAccesible = $false

try {
    & net use "\\10.0.0.89" /persistent:yes 2>$null | Out-Null
    if (Test-Path $OriginMdb) {
        $origenAccesible = $true
    }
} catch {
    $origenAccesible = $false
}

if ($origenAccesible) {
    Log-Msg " -> PC 10.0.0.89 en linea. Verificando modificaciones de la base..." "Green"
    try {
        $origInfo = Get-Item $OriginMdb
        $necesitaCopia = $true

        if (Test-Path $ReplicaMdb) {
            $repInfo = Get-Item $ReplicaMdb
            if ($repInfo.LastWriteTime -eq $origInfo.LastWriteTime -and $repInfo.Length -eq $origInfo.Length -and -not $Force) {
                $necesitaCopia = $false
                Log-Msg " -> La replica local ya se encuentra al dia ($($repInfo.LastWriteTime))." "Gray"
            }
        }

        if ($necesitaCopia) {
            Log-Msg " -> Copiando base viva desde $OriginMdb hacia replica local..." "Yellow"
            $tmpMdb = "$ReplicaMdb.download.tmp"
            if (Test-Path $tmpMdb) { Remove-Item $tmpMdb -Force -ErrorAction SilentlyContinue }

            $srcStream = New-Object System.IO.FileStream($OriginMdb, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $dstStream = New-Object System.IO.FileStream($tmpMdb, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $srcStream.CopyTo($dstStream)
            $srcStream.Close()
            $dstStream.Close()

            $tmpInfo = Get-Item $tmpMdb
            if ($tmpInfo.Length -eq $origInfo.Length) {
                Move-Item -Path $tmpMdb -Destination $ReplicaMdb -Force
                $huboActualizacionMdb = $true
                Log-Msg " -> ¡Replica local actualizada con exito! ($($origInfo.Length) bytes, modif: $($origInfo.LastWriteTime))" "Green"
            } else {
                Remove-Item $tmpMdb -Force -ErrorAction SilentlyContinue
                Log-Msg " -> AVISO: Copia interrumpida ($($tmpInfo.Length) de $($origInfo.Length) bytes). Se conserva replica anterior." "DarkYellow"
            }
        }
    } catch {
        Log-Msg " -> Error al copiar base original: $_. Se utilizara la replica existente." "Red"
    }
} else {
    Log-Msg " -> AVISO: PC 10.0.0.89 no accesible en este momento (posiblemente suspendida o apagada)." "DarkYellow"
    if (Test-Path $ReplicaMdb) {
        $repInfo = Get-Item $ReplicaMdb
        Log-Msg " -> Utilizando ultima replica local disponible del $($repInfo.LastWriteTime)." "Gray"
    } else {
        Log-Msg " -> ERROR CRITICO: No existe replica local y el origen no responde." "Red"
        exit 1
    }
}

# ------------------------------------------------------------------------------
# PASO 2: Exportar base de datos a CSV y JSON
# ------------------------------------------------------------------------------
Log-Msg "[2/3] Exportando datos de marcaciones, turnos y empleados..." "Yellow"

$exportScript = Join-Path $PSScriptRoot "export_data.ps1"
if ($Force) {
    $tokenFile = Join-Path $ProjectRoot "backend\data\.last_sync_token"
    if (Test-Path $tokenFile) { Remove-Item $tokenFile -Force -ErrorAction SilentlyContinue }
}

$exportOutput = & powershell.exe -ExecutionPolicy Bypass -File "$exportScript" 2>&1
$exportExitCode = $LASTEXITCODE

if ($exportExitCode -ne 0) {
    Log-Msg " -> Error en exportacion: $exportOutput" "Red"
} else {
    $summaryLine = ($exportOutput | Select-String -Pattern "Exportaci|sin modificaciones" | Select-Object -Last 1)
    Log-Msg " -> Exportacion finalizada: $summaryLine" "Green"
}

# ------------------------------------------------------------------------------
# PASO 3: Transferir al Servidor Ubuntu (10.0.0.10) y recargar memoria
# ------------------------------------------------------------------------------
Log-Msg "[3/3] Sincronizando archivos con el servidor Ubuntu (10.0.0.10)..." "Yellow"

$syncScript = Join-Path $PSScriptRoot "sync_to_server.js"
$nodeOutput = & node "$syncScript" 2>&1
$nodeExitCode = $LASTEXITCODE

if ($nodeExitCode -eq 0) {
    Log-Msg " -> ¡Servidor 10.0.0.10 actualizado y memoria recargada exitosamente!" "Green"
} else {
    Log-Msg " -> Error al sincronizar con Ubuntu: $nodeOutput" "Red"
}

Log-Msg "Ciclo de sincronizacion finalizado." "Cyan"
Log-Msg "==========================================================" "Cyan"
