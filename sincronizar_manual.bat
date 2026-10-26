@echo off
title Sincronizacion Manual CrossChex - Servidor
chcp 65001 >nul
cls
echo =========================================================
echo    CONTROL DE ACCESO CROSSCHEX - SINCRONIZACIÓN MANUAL
echo =========================================================
echo.
echo Iniciando proceso completo de sincronización...
echo - Origen:    \\10.0.0.89\CrossChex Standard\DB\CrossChex.mdb
echo - Destino:   Servidor Ubuntu 10.0.0.10 (/var/www/control-acceso-crosschex)
echo.
echo Presione cualquier tecla para comenzar o cierre esta ventana para cancelar.
pause >nul

echo.
powershell.exe -ExecutionPolicy Bypass -File "%~dp0backend\src\scripts\sincronizar_completo.ps1" -Force

echo.
echo =========================================================
echo  Proceso finalizado.
echo =========================================================
echo.
pause
