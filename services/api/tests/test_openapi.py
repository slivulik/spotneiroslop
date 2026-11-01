import json

import export_openapi


def test_committed_openapi_is_up_to_date() -> None:
    """Clients are generated from packages/api-schema/openapi.json; it must match the code."""
    assert export_openapi.TARGET.read_text() == export_openapi.render(), (
        "Run `uv run python scripts/export_openapi.py` and commit the result"
    )


def test_operations_have_readable_ids_and_error_envelope() -> None:
    spec = json.loads(export_openapi.render())
    ids = []
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            ids.append(op["operationId"])
            if path.startswith("/v1"):
                # Every /v1 route is rate limited, so 429 with the shared envelope must be documented.
                schema = op["responses"]["429"]["content"]["application/json"]["schema"]
                assert schema == {"$ref": "#/components/schemas/ErrorResponse"}, (path, method)
    assert len(ids) == len(set(ids))
    assert "auth_login" in ids
    assert "catalog_get_track" in ids
