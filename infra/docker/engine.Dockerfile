# Python engine: parsing, layout, visuals, export, render and the deterministic audit.
# The image carries LibreOffice for rendering and only freely redistributable fonts — a
# template's own fonts are read out of the uploaded file at runtime.
FROM python:3.12-slim-bookworm AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:${PATH}"

RUN apt-get update && apt-get install --no-install-recommends -y \
      libreoffice-impress \
      libreoffice-core \
      fonts-dejavu-core \
      fonts-liberation2 \
      fonts-noto-core \
      fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.4 /uv /usr/local/bin/uv

WORKDIR /app

# Dependencies first, so a source change does not re-resolve the environment.
COPY pyproject.toml uv.lock ./
COPY engine/pyproject.toml engine/pyproject.toml
COPY tools/pyproject.toml tools/pyproject.toml
RUN mkdir -p engine/src/engine tools/src/lct_tools \
    && touch engine/src/engine/__init__.py tools/src/lct_tools/__init__.py \
    && uv sync --frozen --no-dev --package engine

COPY engine engine

RUN uv sync --frozen --no-dev --package engine

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health').read()"

CMD ["uvicorn", "engine.api:app", "--host", "0.0.0.0", "--port", "8000"]
