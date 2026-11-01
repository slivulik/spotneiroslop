"""ASGI entrypoint: `uvicorn sonora_api.asgi:app` / `gunicorn -k uvicorn.workers.UvicornWorker`."""

from sonora_api.main import create_app

app = create_app()
