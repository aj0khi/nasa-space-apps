FROM python:3.12-slim

WORKDIR /app/lunar-navigator/backend
COPY lunar-navigator/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend /app/backend
COPY lunar-navigator/backend/app ./app
RUN useradd --create-home app && mkdir -p data/kernels data/dem \
    && chown -R app:app data
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
