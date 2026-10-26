$taskName = "ControlAcceso_AutoSync_30min"
$scriptPath = "c:\Users\AnalistaIT\.gemini\antigravity-ide\scratch\control-acceso-crosschex\backend\src\scripts\sincronizar_completo.ps1"

Write-Host "Configurando tarea programada '$taskName' para ejecutarse cada 30 minutos..."

# 1. Definir acción
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

# 2. Definir trigger repetitivo cada 30 minutos (inicia desde medianoche de hoy y se repite cada 30 min)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 30)

# 3. Definir configuración de resiliencia
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

# 4. Registrar tarea
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Sincronizacion automatica de base de datos CrossChex y servidor Ubuntu 10.0.0.10 cada 30 minutos" -Force | Out-Null

Write-Host "`nVerificando configuracion de la tarea:"
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, @{N='Repeticion';E={$_.Triggers[0].Repetition.Interval}} | Format-Table -AutoSize
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object TaskName, LastRunTime, NextRunTime | Format-Table -AutoSize
