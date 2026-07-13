@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo No se ha encontrado el entorno virtual .venv.
  echo Consulta README.md para instalar las dependencias.
  pause
  exit /b 1
)

echo AeroLab: http://localhost:8010
echo Pantalla completa: http://localhost:8010/fullscreen
echo Modbus TCP: localhost:1502
echo.
echo Pulsa Ctrl+C para detener el simulador.
".venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8010

