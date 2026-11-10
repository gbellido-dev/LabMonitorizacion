@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Falta el entorno virtual. Consulta README.md para instalar las dependencias.
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" (
  call npm.cmd --prefix frontend run build || exit /b 1
)
start "" http://localhost:8020
".venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8020

