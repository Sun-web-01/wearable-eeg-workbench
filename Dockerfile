FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    EEG_HOST=0.0.0.0 \
    EEG_PORT=8000 \
    EEG_DATA_DIR=/data

WORKDIR /app

COPY requirements-team.txt .
RUN pip install --no-cache-dir -r requirements-team.txt

COPY pyproject.toml README.md ./
COPY wearable_eeg ./wearable_eeg
COPY team_platform ./team_platform
COPY team_web ./team_web
COPY data/datasets.json ./data/datasets.json

RUN pip install --no-cache-dir -e .

VOLUME ["/data"]
EXPOSE 8000

CMD ["uvicorn", "team_platform.app:app", "--host", "0.0.0.0", "--port", "8000"]

