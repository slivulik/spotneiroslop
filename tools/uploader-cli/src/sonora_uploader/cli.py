from __future__ import annotations

import argparse
import getpass
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from sonora_uploader.client import ApiError, SonoraAdmin, UploadResult, find_audio, find_cover


def _upload_one(
    client: SonoraAdmin, path: Path, *, publish: bool, allow_duplicate: bool, use_covers: bool
) -> UploadResult:
    result = UploadResult(path=path)
    try:
        cover = find_cover(path.parent) if use_covers else None
        result.job_id = client.upload(path, cover=cover, publish=publish, allow_duplicate=allow_duplicate)
        result.status = "queued"
    except (ApiError, OSError) as exc:
        result.status, result.error = "failed", str(exc)
    return result


def run(argv: list[str] | None = None, *, client: SonoraAdmin | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sonora-upload", description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path, help="files or folders")
    parser.add_argument("--api", default=os.environ.get("SONORA_API", "http://localhost:8000"))
    parser.add_argument("--email", default=os.environ.get("SONORA_EMAIL"))
    parser.add_argument("--publish", action="store_true", help="publish releases once processed")
    parser.add_argument("--allow-duplicate", action="store_true")
    parser.add_argument("--no-covers", action="store_true", help="don't send cover.jpg/folder.jpg files")
    parser.add_argument("--wait", action="store_true", help="wait for processing and report results")
    parser.add_argument("--parallel", type=int, default=4)
    args = parser.parse_args(argv)

    files = [f for p in args.paths for f in find_audio(p.expanduser())]
    if not files:
        print("no .flac or .mp3 files found", file=sys.stderr)
        return 2

    client = client or SonoraAdmin(args.api)
    try:
        email = args.email or input("Admin e-mail: ")
        password = os.environ.get("SONORA_PASSWORD") or getpass.getpass("Password: ")
        client.login(email, password)
        print(f"uploading {len(files)} file(s) to {args.api}")
        with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
            results = list(
                pool.map(
                    lambda f: _upload_one(
                        client, f, publish=args.publish, allow_duplicate=args.allow_duplicate,
                        use_covers=not args.no_covers,
                    ),
                    files,
                )
            )  # fmt: skip
        for r in results:
            print(f"  {'✓' if r.job_id else '✗'} {r.path.name}" + (f"  — {r.error}" if r.error else ""))
        if args.wait:
            print("waiting for processing…")
            client.wait(results)
            for r in results:
                print(f"  [{r.status}] {r.path.name}" + (f"  — {r.error}" if r.error else ""))
                for warning in r.warnings:
                    print(f"      ! {warning['message']}")
    except ApiError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()
    return 1 if any(r.status == "failed" for r in results) else 0


def main() -> None:
    raise SystemExit(run())
