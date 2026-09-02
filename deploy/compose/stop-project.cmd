@echo off
title AI Learning Hub - stop services

set "PROJECT_DIR=D:\AI-Learning-Hub"
set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"

if not exist "%DOCKER_EXE%" goto docker_missing

cd /d "%PROJECT_DIR%\deploy\compose"
"%DOCKER_EXE%" compose --env-file .env -f docker-compose.yml down
if errorlevel 1 goto stop_failed

echo.
echo services stopped. data kept in docker volumes.
pause
exit /b 0

:docker_missing
echo [ERROR] docker cli not found. please install Docker Desktop.
pause
exit /b 1

:stop_failed
echo [ERROR] failed to stop services. see logs above.
pause
exit /b 1