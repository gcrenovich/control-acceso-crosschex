# ==============================================================================
# SCRIPT DE REPLICACIÓN Y BACKUP DIARIO - CROSSCHEX (ANVIZ)
# ==============================================================================

# 1. Configuración de Rutas
$OrigenDB = "\\10.0.0.89\CrossChex Standard\DB\CrossChex.mdb"
$CarpetaDestino = "C:\CrossChex_Replicas"
$LogFile = "$CarpetaDestino\replica_log.txt"

# Fecha actual para el nombre del archivo y logs
$FechaStr = Get-Date -Format "yyyy-MM-dd_HH-mm"

# Archivo con fecha y archivo maestro siempre actualizado
$ArchivoReplicaFecha = "$CarpetaDestino\CrossChex_$FechaStr.mdb"
$ArchivoReplicaLocal = "$CarpetaDestino\CrossChex_Local.mdb"

# Cantidad de copias de respaldo con fecha a conservar (solo la última versión para no acumular espacio)
$MaxCopiasRespaldo = 1

# Crear la carpeta de destino si no existe
if (-not (Test-Path -Path $CarpetaDestino)) {
    New-Item -ItemType Directory -Path $CarpetaDestino -Force | Out-Null
}

function Write-Log {
    param ([string]$Mensaje)
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LineaLog = "[$Timestamp] $Mensaje"
    Write-Host $LineaLog
    Add-Content -Path $LogFile -Value $LineaLog
}

Write-Log "Iniciando replicación de base de datos desde $OrigenDB..."

# 2. Verificar que la base de datos de origen esté accesible
if (Test-Path -Path $OrigenDB) {
    try {
        # Copiar la base de datos creando la réplica con fecha
        Copy-Item -Path $OrigenDB -Destination $ArchivoReplicaFecha -Force -ErrorAction Stop
        
        # Actualizar la réplica maestra (siempre el estado más reciente)
        Copy-Item -Path $OrigenDB -Destination $ArchivoReplicaLocal -Force -ErrorAction Stop

        Write-Log "¡Replicación exitosa! Guardada en:"
        Write-Log " -> $ArchivoReplicaLocal (Réplica activa maestra)"
        Write-Log " -> $ArchivoReplicaFecha (Última copia de respaldo)"

        # 3. Limpieza automática de versiones anteriores para no acumular archivos
        # Se conservan únicamente las $MaxCopiasRespaldo más recientes (1 copia con fecha)
        $copiasConFecha = Get-ChildItem -Path $CarpetaDestino -Filter "CrossChex_2*.mdb" | Sort-Object LastWriteTime -Descending
        if ($copiasConFecha.Count -gt $MaxCopiasRespaldo) {
            $aBorrar = $copiasConFecha | Select-Object -Skip $MaxCopiasRespaldo
            foreach ($item in $aBorrar) {
                Remove-Item -Path $item.FullName -Force -ErrorAction SilentlyContinue
                Write-Log "Eliminada versión anterior acumulada: $($item.Name)"
            }
        }

        # 4. Limpieza automática de archivos temporales huérfanos o archivos de bloqueo
        Get-ChildItem -Path $CarpetaDestino -Filter "CrossChex_Exp_*" -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
            Write-Log "Eliminado temporal huérfano: $($_.Name)"
        }

    } catch {
        Write-Log "ERROR al copiar la base de datos: $_"
    }
} else {
    Write-Log "ERROR: No se pudo acceder a la ruta de red '$OrigenDB'. Verifica la conexión de red o si la PC servidor está encendida."
}
