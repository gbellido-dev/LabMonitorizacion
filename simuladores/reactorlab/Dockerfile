# ---- Vista 3D de GRFICS (opcional): modelos Unity WebGL, ~230 MB ----------
# Son demasiado grandes para el repositorio, así que se descargan del proyecto
# original (GRFICSv3, GPL-3.0) fijando el commit y comprobando su SHA-256.
# Sin Internet, o con --build-arg VISTA_3D=0, la imagen se construye sin ellos.
FROM python:3.12-slim AS vista3d
ARG VISTA_3D=1
ARG GRFICS_COMMIT=8d611b773fa74e3a82ff149c447cff8380eaa99a
WORKDIR /descarga
COPY vista3d/descargar.py .
RUN python descargar.py "$VISTA_3D" "$GRFICS_COMMIT" /descarga/salida

# ---- ReactorLab ---------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY frontend/ frontend/
COPY vista3d/ vista3d/
COPY --from=vista3d /descarga/salida/ vista3d/
EXPOSE 8030
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8030"]
