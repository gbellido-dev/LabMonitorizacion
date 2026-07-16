@echo off
rem Arranca el servidor de desarrollo con recarga en caliente en http://localhost:3000
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
call npm run dev
pause
