@echo off
rem Compila la aplicacion para produccion (salida en dist\)
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
call npm run build
pause
