$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "No existe .venv. Ejecuta primero: python -m venv .venv"
}

$backend = Start-Process `
    -FilePath $python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--reload", "--host", "0.0.0.0", "--port", "8010" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru

try {
    & npm.cmd --prefix (Join-Path $root "frontend") run dev
}
finally {
    if (-not $backend.HasExited) {
        Stop-Process -Id $backend.Id
    }
}
