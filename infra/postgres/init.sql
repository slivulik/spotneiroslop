-- Runs once when the volume is first created. Migrations also create `vector` (idempotent).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
