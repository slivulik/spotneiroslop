# sonora-upload

Bulk upload of a music folder through the admin API (presigned uploads straight to storage).

```bash
cd tools/uploader-cli && uv sync
export SONORA_API=https://api.example.com SONORA_EMAIL=admin@example.com
uv run sonora-upload ~/Music/Albums --publish --wait
```

* Recurses into the folder, uploads every `.flac` / `.mp3`.
* A `cover.jpg|png|webp` or `folder.jpg` next to the files is sent as the cover when a file has
  no embedded artwork.
* `--wait` polls until processing finishes and prints warnings (e.g. suspected lossy source)
  and failures; exit code is non-zero if anything failed.
* `--allow-duplicate` keeps files whose recording already exists in the catalogue.
* Password comes from `SONORA_PASSWORD` or an interactive prompt — never a CLI argument.
