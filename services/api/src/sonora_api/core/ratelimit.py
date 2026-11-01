import math
import time
from dataclasses import dataclass

from redis.asyncio import Redis

# GCRA (generic cell rate algorithm): one key per bucket holding the "theoretical arrival
# time". Smooth limiting without the burst-at-window-edge problem of fixed windows, and a
# single atomic round trip.
_GCRA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local tat = tonumber(redis.call('GET', key) or now)
if tat < now then tat = now end
local allow_at = tat - burst * interval
if now < allow_at then
  return {0, tostring(allow_at - now)}
end
local new_tat = tat + interval
redis.call('SET', key, tostring(new_tat), 'PX', math.ceil((new_tat - now) * 1000) + 1000)
return {1, '0'}
"""


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    retry_after: int


class RateLimiter:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self._script = redis.register_script(_GCRA)

    async def hit(self, key: str, *, per_minute: int, burst: int | None = None) -> RateLimitResult:
        """Consume one unit from `key`'s budget of `per_minute` requests.

        `burst` is how many requests may arrive back-to-back (defaults to the full minute's budget).
        """
        interval = 60.0 / per_minute
        allowed, wait = await self._script(
            keys=[f"rl:{key}"], args=[f"{time.time():.6f}", f"{interval:.6f}", (burst or per_minute) - 1]
        )
        return RateLimitResult(
            allowed=bool(allowed), retry_after=max(1, math.ceil(float(wait))) if not allowed else 0
        )
