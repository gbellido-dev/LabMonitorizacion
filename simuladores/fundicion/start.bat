@echo off
rem Arranca el servidor de produccion en http://localhost:3000
rem Requiere haber ejecutado build.bat antes (o lo lanza si falta dist\)
cd /d "%~dp0"
if not exist dist (
  echo No hay build previa, compilando...
  call npm run build
)
call npm run start
pause
