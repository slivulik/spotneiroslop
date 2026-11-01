import hashlib

import orjson
from fastapi import Request, Response
from pydantic import BaseModel


def cached_json(
    request: Request,
    model: BaseModel,
    *,
    max_age: int,
    public: bool,
    stale_while_revalidate: int = 0,
) -> Response:
    """Serialise `model`, attach a strong ETag and answer 304 when the client already has it.

    `public` responses may be cached by the CDN; personalised ones (e.g. `playable` depends
    on the user's explicit filter) are `private` and vary on Authorization.
    """
    body = orjson.dumps(model.model_dump(mode="json"))
    etag = f'"{hashlib.blake2b(body, digest_size=16).hexdigest()}"'
    directives = [("public" if public else "private"), f"max-age={max_age}"]
    if stale_while_revalidate:
        directives.append(f"stale-while-revalidate={stale_while_revalidate}")
    headers = {"ETag": etag, "Cache-Control": ", ".join(directives), "Vary": "Authorization"}

    if_none_match = request.headers.get("if-none-match")
    if if_none_match and etag in {tag.strip().removeprefix("W/") for tag in if_none_match.split(",")}:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)
