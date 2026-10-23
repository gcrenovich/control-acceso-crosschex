# ==============================================================================
# SCRIPT DE TRANSFERENCIA DE DATOS A SERVIDOR UBUNTU (CROSSCHEX)
# ==============================================================================
# Este script toma los archivos exportados localmente en Windows y los transfiere
# de forma segura al servidor en Ubuntu mediante el endpoint /api/sync/push
# Transfiere archivo por archivo para optimizar el uso de memoria de red.

param (
    [string]$UbuntuServerUrl = "http://10.0.0.10", # Servidor Ubuntu en 10.0.0.10
    [string]$ApiKey = "mi_clave_secreta_crosschex_2026"
)

$DataDir = Join-Path $PSScriptRoot "..\..\data"
$DataDir = [System.IO.Path]::GetFullPath($DataDir)

$FilesToSync = @(
    "departments.json",
    "users.json",
    "timetables.json",
    "schedules.json",
    "sch_times.json",
    "user_shifts.json",
    "user_temp_shifts.csv",
    "leave_classes.json",
    "user_leaves.json",
    "checkinout.csv"
)

Write-Host "Iniciando transferencia segura hacia Ubuntu en $UbuntuServerUrl ..." -ForegroundColor Cyan

$headers = @{
    "Content-Type" = "application/json; charset=utf-8"
    "x-api-key"    = $ApiKey
}

$archivosValidos = @()
foreach ($f in $FilesToSync) {
    $p = Join-Path $DataDir $f
    if (Test-Path $p) {
        $archivosValidos += $f
    } else {
        Write-Warning "Archivo $f no encontrado en $DataDir, se omite."
    }
}

if ($archivosValidos.Count -eq 0) {
    Write-Error "No se encontraron archivos para transferir."
    exit 1
}

$total = $archivosValidos.Count
$idx = 0

foreach ($fileName in $archivosValidos) {
    $idx++
    $isLast = ($idx -eq $total)
    $filePath = Join-Path $DataDir $fileName
    $fileInfo = Get-Item $filePath
    $mbSize = [Math]::Round(($fileInfo.Length / 1MB), 2)

    Write-Host "[$idx/$total] Enviando $fileName ($mbSize MB)..." -NoNewline

    $content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

    $payload = @{
        fileName = $fileName
        content  = $content
        reload   = $isLast
    }

    $bodyJson = $payload | ConvertTo-Json -Depth 3

    try {
        $response = Invoke-RestMethod -Uri "$UbuntuServerUrl/api/sync/push" -Method Post -Headers $headers -Body $bodyJson -TimeoutSec 120
        Write-Host " -> OK" -ForegroundColor Green
    } catch {
        Write-Host " -> ERROR: $_" -ForegroundColor Red
    }
}

Write-Host "🎉 Sincronización completada hacia $UbuntuServerUrl" -ForegroundColor Green
