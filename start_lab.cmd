@echo off
rem Arranca todo el laboratorio (simuladores + Node-RED + Mosquitto + ThingsBoard).
cd /d "%~dp0"
docker compose up -d --build || exit /b 1
echo.
echo   AeroLab      http://localhost:8010
echo   OceanLab     http://localhost:8020
echo   SolarLab     http://localhost:8000
echo   Fundicion    http://localhost:3000
echo   Node-RED     http://localhost:1880
echo   ThingsBoard  http://localhost:8080   (tarda 1-2 min en arrancar)
echo.
pause
