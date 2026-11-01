"""`sonora-media-worker` → runs the Dramatiq worker for the media queue."""

import os
import sys

from dramatiq.cli import main as dramatiq_main


def main() -> int:
    # Transcoding is CPU-bound: one process per core, one job per process at a time.
    processes = os.environ.get("SONORA_WORKER_PROCESSES", str(os.cpu_count() or 2))
    sys.argv = [
        "dramatiq",
        "sonora_media.actors",
        "--processes",
        processes,
        "--threads",
        "1",
        "--queues",
        "media",
    ]
    return int(dramatiq_main() or 0)


if __name__ == "__main__":
    raise SystemExit(main())
