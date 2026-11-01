#!/bin/sh
# SeaweedFS (S3 API on :8333). Credentials come from the environment; the `sonora-public` bucket
# (artwork) is anonymously readable, everything else needs a signature.
set -eu
umask 077
cat > /tmp/s3.json <<JSON
{
  "identities": [
    {
      "name": "sonora",
      "credentials": [{"accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}"}],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    },
    {"name": "anonymous", "actions": ["Read:sonora-public"]}
  ]
}
JSON
exec weed server -dir=/data -ip.bind=0.0.0.0 -master.volumeSizeLimitMB=1024 -volume.max=0 \
  -s3 -s3.port=8333 -s3.config=/tmp/s3.json
