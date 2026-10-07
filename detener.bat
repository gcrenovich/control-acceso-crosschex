@echo off
title Control de Acceso - Detener Servicios
echo =============================================
echo   Deteniendo Servicios de Control de Acceso
echo =============================================

echo Buscando y cerrando procesos en el puerto 3005 (Backend)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3005 ^| findstr LISTENING 2^>nul') do (
    echo Cerrando proceso Backend PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

echo Buscando y cerrando ventanas de comandos lanzadas...
taskkill /FI "WINDOWTITLE eq Backend - Control Acceso*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend - Control Acceso*" /F >nul 2>&1

echo.
echo Servicios detenidos correctamente.
echo.
ping 127.0.0.1 -n 3 >nul
