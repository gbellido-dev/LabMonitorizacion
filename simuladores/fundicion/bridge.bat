@echo off
rem Arranca el puente OPC UA -> WebSocket (ws://localhost:8081)
rem Requiere el servidor OPC UA activo (opcua.bat); si no lo esta, reintenta.
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
call npm run opcua:bridge
pause
