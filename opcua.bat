@echo off
rem Arranca el servidor OPC UA de la simulacion
rem Endpoint: opc.tcp://localhost:4840/UA/Fundicion
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
call npm run opcua
pause
