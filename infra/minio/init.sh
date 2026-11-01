#!/bin/sh
# Creates the media bucket. Artwork, previews and HLS segments are served through signed URLs
# or the CDN; only `public/` (artwork, genre tiles) is anonymously readable.
set -eu
mc alias set local http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc mb --ignore-existing local/sonora-media
mc mb --ignore-existing local/sonora-uploads
mc anonymous set download local/sonora-media/public
echo "buckets ready"
