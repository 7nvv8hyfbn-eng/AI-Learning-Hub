@echo off
setlocal enabledelayedexpansion
title AI Learning Hub - one click start

set "PROJECT_DIR=D:\AI-Learning-Hub"
set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"

if not exist "%DOCKER_EXE%" goto docker_missing

"%DOCKER_EXE%" info >nul 2>&1
if errorlevel 1 goto start_docker
goto engine_ready

:docker_missing
echo [ERROR] docker cli not found. please install Docker Desktop.
pause
exit /b 1

:start_docker
echo starting Docker Desktop...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
echo waiting for docker engine (first start may take 1-2 min)...
set /a tries=0

:wait_docker
"%DOCKER_EXE%" info >nul 2>&1
if not errorlevel 1 goto engine_ready
set /a tries+=1
if !tries! geq 60 goto engine_timeout
ping -n 4 127.0.0.1 >nul
goto wait_docker

:engine_timeout
echo [ERROR] docker engine start timeout. open Docker Desktop manually.
pause
exit /b 1

:engine_ready
echo docker engine ready.
echo starting services...

cd /d "%PROJECT_DIR%\deploy\compose"
"%DOCKER_EXE%" compose --env-file .env -f docker-compose.yml up -d
if errorlevel 1 goto start_failed

echo.
echo services started!
echo   student: http://127.0.0.1:8080
echo   admin:   http://127.0.0.1:8081
echo   api docs: http://127.0.0.1:8080/api/docs
echo.
echo opening student page...
start "" "http://127.0.0.1:8080"
echo.
echo note: if containers already running, page opens directly.
ping -n 4 127.0.0.1 >nul
exit /b 0

:start_failed
echo [ERROR] failed to start services. see logs above.
pause
exit /b 1