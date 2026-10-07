@echo off
title Control de Acceso - Reiniciar Servicios
echo =============================================
echo  Reiniciando Servicios de Control de Acceso
echo =============================================

call "%~dp0detener.bat"
echo Esperando 2 segundos...
ping 127.0.0.1 -n 2 >nul
call "%~dp0iniciar.bat"
