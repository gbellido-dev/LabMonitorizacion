@echo off
rem Arranca todo el laboratorio (simuladores + Node-RED + Mosquitto + ThingsBoard).
cd /d "%~dp0"
docker compose up -d --build || exit /b 1
echo.
echo   AeroLab      http://localhost:8010
echo   OceanLab     http://localhost:8020
echo   SolarLab     http://localhost:8000
echo   Fundicion    http://localhost:3000
echo   ReactorLab   http://localhost:8030   (vista 3D en /3d/)
echo   Node-RED     http://localhost:1880
echo   ThingsBoard  http://localhost:8080   (1-2 min; la primera vez, hasta 3)
echo   Copias       http://localhost:8090
echo.
pause
