# CBLAero Initial Migration Scripts

One-time admin-supervised pipeline to load the initial 1M candidate corpus into Supabase.

## Files

| File | Purpose |
|---|---|
| `initial_load.py` | Main migration script — runs as a Render one-off job |
| `rollback_batch.py` | Purge a partial batch if error threshold was exceeded |
| `requirements.txt` | Python dependencies |

## Prerequisites

- Python 3.11+
- Install deps: `pip install -r requirements.txt`
- Supabase schema applied (`cblaero/supabase/schema.sql`)
- Source CSV file accessible from the Render job environment

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Service-role key (backend only) |
| `CBL_SUPABASE_SCHEMA` | No | `cblaero_app` | Schema name |
| `MIGRATION_TENANT_ID` | Yes | — | Tenant ID for all imported records |
| `MIGRATION_SOURCE_FILE` | Yes | — | Absolute path to source CSV |
| `MIGRATION_CHUNK_SIZE` | No | `1000` | Rows per transaction |
| `MIGRATION_ERROR_THRESHOLD_PCT` | No | `5` | Per-chunk error % that triggers pause |

> **Security:** `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. Set it as a Render environment secret only. Never commit it to source control or expose it to the browser.
>
> **Transport Security:** `supabase-py` communicates over HTTPS (TLS). The `sslmode=require` parameter applies to direct Postgres drivers such as `psycopg2`, not to Supabase REST calls.

## CSV Format

Required columns: `name` AND one of `email` or `phone`.

Optional columns: `location`, `skills` (JSON array), `certifications` (JSON array), `experience` (JSON array), `availability_status` (`active` | `passive` | `unavailable`).

```csv
name,email,phone,location,availability_status
John Smith,john@example.com,,Phoenix AZ,active
Jane Doe,,+15550001234,Dallas TX,passive
```

## Running on Render

1. Create a **one-off job** in the Render dashboard for the `cblaero` service.
2. Set all required environment variables in Render secrets.
3. Set `MIGRATION_SOURCE_FILE` to the path of the uploaded CSV (use Render Disk or upload to an accessible path).
4. Run command: `python scripts/migrate/initial_load.py`
5. Monitor structured JSON logs in the Render job output.
6. On completion, the `import_batch` table shows `status=complete`.
7. Trigger the deduplication worker (Story 2.5) over the batch.

## Error Threshold Behaviour

If any 1,000-row chunk has more than `MIGRATION_ERROR_THRESHOLD_PCT`% errors:

- The job pauses immediately with exit code 1.
- `import_batch.status` is set to `paused_on_error_threshold`.
- Render will log the failure and notify configured alert channels.
- Run rollback (below) to purge the partial batch.
- Fix the source CSV and re-run.

## Transaction Semantics Note

Current script behavior uses a single SQL RPC call (`process_import_chunk`) per chunk. Candidate upserts, row-error inserts, and progress-counter updates happen inside one Postgres transaction.

Per-row candidate conflicts are isolated in the SQL function, so one bad candidate does not fail the full chunk.

## Rolling Back a Partial Batch

```bash
python scripts/migrate/rollback_batch.py --batch-id <uuid>
```

The rollback:
- Deletes all `candidates` rows with `source_batch_id=<uuid>` and `ingestion_state=pending_dedup`
- Deletes all `import_row_error` rows for the batch
- Sets `import_batch.status=rolled_back`
- Runs in chunks of 10,000 rows to avoid lock contention

## Admin Progress View

After a migration run, admins can see batch status at:

```
/dashboard/admin
```

The **Initial Migration** card shows: status, progress bar, imported count, error count, and a link to the batch detail API endpoint.
