@echo off
:menu
cls
title Control de Acceso CrossChex - Panel de Control
echo ===================================================
echo     CONTROL DE ACCESO CROSSCHEX - SERVICIOS
echo ===================================================
echo.
echo  [1] Iniciar Servicios (Backend + Frontend)
echo  [2] Detener / Suspender Servicios
echo  [3] Reiniciar Servicios
echo  [4] Ver Estado de los Servicios
echo  [5] Salir
echo.
echo ===================================================
set /p opcion="Seleccione una opcion [1-5]: "

if "%opcion%"=="1" (
    call "%~dp0iniciar.bat"
    goto menu
)
if "%opcion%"=="2" (
    call "%~dp0detener.bat"
    goto menu
)
if "%opcion%"=="3" (
    call "%~dp0reiniciar.bat"
    goto menu
)
if "%opcion%"=="4" (
    cls
    echo ===================================================
    echo             ESTADO ACTUAL DE SERVICIOS
    echo ===================================================
    echo.
    echo --- Backend (Puerto 3005) ---
    netstat -aon | findstr :3005 | findstr LISTENING >nul 2>&1
    if %errorlevel% equ 0 (
        echo [EN EJECUCION] Backend activo en puerto 3005
    ) else (
        echo [DETENIDO] Backend no detectado en puerto 3005
    )
    echo.
    echo --- Frontend (Puerto 5173 / Vite) ---
    netstat -aon | findstr :5173 | findstr LISTENING >nul 2>&1
    if %errorlevel% equ 0 (
        echo [EN EJECUCION] Frontend activo en puerto 5173
    ) else (
        echo [DETENIDO] Frontend no detectado en puerto 5173
    )
    echo.
    echo ===================================================
    pause
    goto menu
)
if "%opcion%"=="5" exit

goto menu
