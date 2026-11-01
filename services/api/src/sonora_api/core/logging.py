import logging
import sys

import structlog


def configure_logging(level: str = "INFO", *, json: bool = True, cache: bool = True) -> None:
    """Structured logs: JSON in production, coloured key-value output locally."""
    shared: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    renderer: structlog.types.Processor = (
        structlog.processors.JSONRenderer(ensure_ascii=False) if json else structlog.dev.ConsoleRenderer()
    )
    structlog.configure(
        processors=[
            *shared,
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelNamesMapping()[level.upper()]),
        logger_factory=structlog.PrintLoggerFactory(sys.stdout),
        # Tests disable caching so structlog.testing.capture_logs can intercept module loggers.
        cache_logger_on_first_use=cache,
    )
    # Route stdlib loggers (uvicorn, sqlalchemy) through the same level.
    logging.basicConfig(level=level.upper(), stream=sys.stdout, format="%(message)s")
    logging.getLogger("uvicorn.access").disabled = True  # replaced by our access log middleware


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)  # type: ignore[no-any-return]
