# ==============================================================================
# SCRIPT DE TRANSFERENCIA DE DATOS A SERVIDOR UBUNTU (CROSSCHEX)
# ==============================================================================
# Este script toma los archivos exportados localmente en Windows y los transfiere
# de forma segura al servidor en Ubuntu mediante el endpoint /api/sync/push

param (
    [string]$UbuntuServerUrl = "http://10.0.0.200:3005", # Modificar con la IP o dominio del servidor Ubuntu
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

Write-Host "Iniciando transferencia segura hacia Ubuntu en $UbuntuServerUrl ..."

$payloadFiles = @()

foreach ($fileName in $FilesToSync) {
    $filePath = Join-Path $DataDir $fileName
    if (Test-Path $filePath) {
        Write-Host "Preparando $fileName ..."
        $content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)
        $payloadFiles += @{
            fileName = $fileName
            content  = $content
        }
    } else {
        Write-Warning "Archivo $fileName no encontrado en $DataDir, se omite."
    }
}

if ($payloadFiles.Count -eq 0) {
    Write-Error "No se encontraron archivos para transferir."
    exit 1
}

$bodyJson = @{ files = $payloadFiles } | ConvertTo-Json -Depth 5

try {
    $headers = @{
        "Content-Type" = "application/json; charset=utf-8"
        "x-api-key"    = $ApiKey
    }

    $response = Invoke-RestMethod -Uri "$UbuntuServerUrl/api/sync/push" -Method Post -Headers $headers -Body $bodyJson
    Write-Host "¡Transferencia exitosa!" -ForegroundColor Green
    Write-Host "Respuesta del servidor Ubuntu: $($response.message)"
} catch {
    Write-Error "Error al transferir datos al servidor Ubuntu: $_"
}
