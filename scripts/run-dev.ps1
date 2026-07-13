$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Falta .venv. Consulta README.md para instalar las dependencias."
}

$api = Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--reload", "--host", "0.0.0.0", "--port", "8000" -WorkingDirectory $root -WindowStyle Hidden -PassThru
$web = Start-Process -FilePath "npm.cmd" -ArgumentList "--prefix", "frontend", "run", "dev" -WorkingDirectory $root -WindowStyle Hidden -PassThru

Write-Host "SolarLab iniciado: http://localhost:5173"
Write-Host "OPC UA: opc.tcp://localhost:4840/solarlab/server/"
Write-Host "Pulsa Ctrl+C para detenerlo."
try {
    Wait-Process -Id $api.Id, $web.Id
} finally {
    Stop-Process -Id $api.Id, $web.Id -Force -ErrorAction SilentlyContinue
}
