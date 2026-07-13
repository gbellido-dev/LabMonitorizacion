$Root = Split-Path -Parent $PSScriptRoot
Start-Process -FilePath "$Root\.venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--reload", "--host", "0.0.0.0", "--port", "8020" -WorkingDirectory $Root
Start-Process -FilePath "npm.cmd" -ArgumentList "--prefix", "frontend", "run", "dev" -WorkingDirectory $Root

