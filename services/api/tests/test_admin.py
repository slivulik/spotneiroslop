import uuid
from typing import Any

import orjson

from sonora_api.core.tasks import PROCESS_UPLOAD_ACTOR
from sonora_api.models import UploadJob
from sonora_api.models.enums import JobStatus, ReleaseStatus
from tests.conftest import Catalog, Harness, bearer, make_admin, register

BUCKET = "sonora-uploads"
NEW_UPLOAD = {
    "source": {"filename": "01 - Song.FLAC", "size_bytes": 1234},
    "cover": {"filename": "cover.jpg", "size_bytes": 99},
    "options": {"publish": True},
}


async def _create(
    harness: Harness, admin: dict[str, Any], body: dict[str, Any] = NEW_UPLOAD
) -> dict[str, Any]:
    response = await harness.client.post("/v1/admin/uploads", headers=bearer(admin), json=body)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def test_admin_routes_require_admin_role(harness: Harness) -> None:
    listener = await register(harness.client)
    assert (await harness.client.get("/v1/admin/uploads")).status_code == 401
    forbidden = await harness.client.get("/v1/admin/uploads", headers=bearer(listener))
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "forbidden"


async def test_upload_lifecycle(harness: Harness) -> None:
    admin = await make_admin(harness)
    created = await _create(harness, admin)
    job_id = created["job_id"]
    roles = {u["role"]: u for u in created["uploads"]}
    assert roles["source"]["url"].startswith(f"https://s3.test/{BUCKET}/jobs/{job_id}/source.flac")
    assert roles["source"]["headers"] == {"Content-Type": "audio/flac"}
    assert roles["cover"]["headers"] == {"Content-Type": "image/jpeg"}

    complete_url = f"/v1/admin/uploads/{job_id}/complete"
    missing = await harness.client.post(complete_url, headers=bearer(admin))
    assert missing.json()["error"]["code"] == "upload_missing"

    harness.storage.objects[(BUCKET, f"jobs/{job_id}/source.flac")] = 1234
    harness.storage.objects[(BUCKET, f"jobs/{job_id}/cover.jpg")] = 98
    mismatch = await harness.client.post(complete_url, headers=bearer(admin))
    assert mismatch.json()["error"]["code"] == "upload_size_mismatch"

    harness.storage.objects[(BUCKET, f"jobs/{job_id}/cover.jpg")] = 99
    done = await harness.client.post(complete_url, headers=bearer(admin))
    assert done.status_code == 200
    assert done.json()["status"] == "queued"
    assert done.json()["options"] == {"publish": True, "allow_duplicate": False}

    assert len(harness.broker.queues["media"].queue) == 1
    assert (await harness.client.post(complete_url, headers=bearer(admin))).status_code == 409

    detail = (await harness.client.get(f"/v1/admin/uploads/{job_id}", headers=bearer(admin))).json()
    assert detail["logs"] == []
    listing = (
        await harness.client.get("/v1/admin/uploads", headers=bearer(admin), params={"status": "queued"})
    ).json()
    assert [j["id"] for j in listing["items"]] == [job_id]


async def test_enqueued_message_contract(harness: Harness) -> None:
    admin = await make_admin(harness)
    created = await _create(harness, admin, {"source": {"filename": "a.mp3", "size_bytes": 5}})
    harness.storage.objects[(BUCKET, f"jobs/{created['job_id']}/source.mp3")] = 5
    await harness.client.post(f"/v1/admin/uploads/{created['job_id']}/complete", headers=bearer(admin))
    raw = harness.broker.queues["media"].queue.popleft()
    message = orjson.loads(raw)
    assert message["actor_name"] == PROCESS_UPLOAD_ACTOR
    assert message["args"] == [created["job_id"]]


async def test_upload_validation(harness: Harness) -> None:
    admin = await make_admin(harness)
    bad_type = await harness.client.post(
        "/v1/admin/uploads", headers=bearer(admin), json={"source": {"filename": "song.wav", "size_bytes": 1}}
    )
    assert bad_type.status_code == 422
    too_big = await harness.client.post(
        "/v1/admin/uploads",
        headers=bearer(admin),
        json={"source": {"filename": "x.flac", "size_bytes": 3 * 1024**3}},
    )
    assert too_big.status_code == 413


async def test_retry_discards_later_checkpoints(harness: Harness) -> None:
    admin = await make_admin(harness)
    created = await _create(harness, admin, {"source": {"filename": "a.flac", "size_bytes": 5}})
    job_id = uuid.UUID(created["job_id"])
    async with harness.ctx.sessionmaker() as s:
        job = await s.get(UploadJob, job_id)
        assert job is not None
        job.status = JobStatus.FAILED
        job.stage = "transcode"
        job.error = "ffmpeg exploded"
        job.state = {
            "probe": {},
            "authenticity": {},
            "tags": {},
            "fingerprint": {},
            "loudness": {},
            "catalog": {},
        }
        await s.commit()

    retried = await harness.client.post(f"/v1/admin/jobs/{job_id}/retry", headers=bearer(admin), json={})
    assert retried.status_code == 200
    body = retried.json()
    assert body["status"] == "queued"
    assert body["error"] is None
    assert body["completed_stages"] == ["probe", "authenticity", "tags", "fingerprint", "loudness", "catalog"]

    # Explicit earlier stage drops more checkpoints; running jobs can't be retried.
    async with harness.ctx.sessionmaker() as s:
        job = await s.get(UploadJob, job_id)
        assert job is not None
        job.status = JobStatus.FAILED
        await s.commit()
    again = await harness.client.post(
        f"/v1/admin/jobs/{job_id}/retry", headers=bearer(admin), json={"from_stage": "tags"}
    )
    assert again.json()["completed_stages"] == ["probe", "authenticity"]
    busy = await harness.client.post(f"/v1/admin/jobs/{job_id}/retry", headers=bearer(admin), json={})
    assert busy.status_code == 409
    assert len(harness.broker.queues["media"].queue) == 2


async def test_publish_release(harness: Harness, catalog_data: Catalog) -> None:
    admin = await make_admin(harness)
    hidden_id = catalog_data.hidden_release.id
    assert (await harness.client.get(f"/v1/releases/{hidden_id}")).status_code == 404
    response = await harness.client.patch(
        f"/v1/admin/releases/{hidden_id}", headers=bearer(admin), json={"publish_at": None}
    )
    assert response.status_code == 204
    assert (await harness.client.get(f"/v1/releases/{hidden_id}")).status_code == 200

    await harness.client.patch(
        f"/v1/admin/releases/{hidden_id}", headers=bearer(admin), json={"status": ReleaseStatus.HIDDEN.value}
    )
    assert (await harness.client.get(f"/v1/releases/{hidden_id}")).status_code == 404
    null_status = await harness.client.patch(
        f"/v1/admin/releases/{hidden_id}", headers=bearer(admin), json={"status": None}
    )
    assert null_status.status_code == 422
