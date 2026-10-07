@echo off
title Control de Acceso - Iniciar Servicios
echo =============================================
echo   Iniciando Servicios de Control de Acceso
echo =============================================

echo [0/2] Verificando y liberando puertos 3005 y 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3005 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [1/2] Iniciando Backend (Node.js API)...
start "Backend - Control Acceso" /D "%~dp0backend" cmd /k "npm.cmd run dev"

echo [2/2] Iniciando Frontend (Vite React)...
start "Frontend - Control Acceso" /D "%~dp0frontend" cmd /k "npm.cmd run dev"

echo.
echo Servidores iniciados en la red.
echo - Acceso Local:      http://localhost:5173
echo - Acceso en Red LAN: http://10.0.0.109:5173 (o la IP de este equipo)
echo.
ping 127.0.0.1 -n 4 >nul
