@echo off
rem Inicializa la base de datos de ThingsBoard (solo la primera vez).
cd /d "%~dp0.."
docker compose up -d tb-postgres || exit /b 1
echo Esperando a PostgreSQL...
:espera
docker compose exec -T tb-postgres pg_isready -U postgres >nul 2>&1
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto espera
)
docker compose run --rm -e INSTALL_TB=true -e LOAD_DEMO=true thingsboard || exit /b 1
echo ThingsBoard inicializado. Arranca el laboratorio con start_lab.cmd
