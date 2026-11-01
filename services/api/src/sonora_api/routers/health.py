from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from sonora_api import __version__
from sonora_api.deps import Ctx

router = APIRouter(tags=["health"])


@router.get("/healthz", summary="Liveness probe", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/readyz", summary="Readiness probe (DB + Redis)", include_in_schema=False)
async def readyz(ctx: Ctx) -> JSONResponse:
    checks: dict[str, str] = {}
    try:
        async with ctx.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as exc:
        checks["postgres"] = f"error: {type(exc).__name__}"
    try:
        await ctx.redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {type(exc).__name__}"
    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        {"status": "ok" if healthy else "degraded", "checks": checks}, status_code=200 if healthy else 503
    )
