"""Write the OpenAPI document to packages/api-schema/openapi.json.

Usage: uv run python scripts/export_openapi.py [--check]
`--check` exits non-zero when the committed file is stale (used in CI and tests).
"""

import json
import os
import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parents[3] / "packages" / "api-schema" / "openapi.json"


def render() -> str:
    # The schema doesn't depend on runtime secrets; a placeholder keeps Settings valid.
    os.environ.setdefault("SONORA_JWT_SECRET", "openapi-export-placeholder-secret-0000")
    from sonora_api.main import create_app  # noqa: PLC0415 - must run after the env is prepared

    return json.dumps(create_app().openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    document = render()
    if "--check" in sys.argv:
        if not TARGET.exists() or TARGET.read_text() != document:
            print(f"{TARGET} is out of date: run scripts/export_openapi.py", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(document)
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
