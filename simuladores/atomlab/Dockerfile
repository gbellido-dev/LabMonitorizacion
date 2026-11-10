# AtomLab · central RBMK didáctica (OPC UA + sala de control web con vista 3D)
FROM node:22-alpine AS vendor
WORKDIR /f
COPY frontend/package.json frontend/package-lock.json frontend/copiar-vendor.mjs ./
RUN npm ci --no-audit --no-fund && node copiar-vendor.mjs

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app ./backend/app
COPY frontend/index.html frontend/styles.css ./frontend/
COPY frontend/js ./frontend/js
COPY --from=vendor /f/vendor ./frontend/vendor
EXPOSE 8040 4842
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8040"]
