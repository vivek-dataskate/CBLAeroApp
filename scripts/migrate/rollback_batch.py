#!/usr/bin/env python3
"""
CBLAero Migration Batch Rollback Script
========================================
Purges all candidate rows associated with a specific import batch
and marks the batch as rolled_back.

Runs in delete transactions of 10,000 rows to avoid lock contention at scale.

Environment variables (required):
  SUPABASE_URL                 Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY    Service-role key (backend only)
  CBL_SUPABASE_SCHEMA          Schema name (default: cblaero_app)

Usage:
  python rollback_batch.py --batch-id <uuid>
"""

import argparse
import json
import sys
import os
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SCHEMA = os.environ.get("CBL_SUPABASE_SCHEMA", "cblaero_app")

DELETE_CHUNK_SIZE = 10_000

MODULE = "RollbackBatch"
TRACE_ID = str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Structured logging helper (§17 / §23 compliant)
# ---------------------------------------------------------------------------

def _log(level: str, action: str, **kwargs: Any) -> None:
    entry = {
        "level": level,
        "module": MODULE,
        "action": action,
        "traceId": TRACE_ID,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **kwargs,
    }
    print(json.dumps(entry), flush=True)


def _validate_config() -> None:
    missing = [
        name
        for name, val in {
            "SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
        }.items()
        if not val
    ]
    if missing:
        _log("error", "config_error", missing_vars=missing)
        sys.exit(1)


def _build_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _fetch_batch(client: Client, batch_id: str) -> dict | None:
    try:
        result = (
            client.schema(SCHEMA)
            .from_("import_batch")
            .select("id, status, imported, tenant_id")
            .eq("id", batch_id)
            .execute()
        )
    except Exception as exc:
        _log("error", "fetch_batch", batchId=batch_id,
             error=str(exc), stack=traceback.format_exc())
        sys.exit(1)

    if hasattr(result, "error") and result.error:
        _log("error", "fetch_batch", batchId=batch_id, error=str(result.error))
        sys.exit(1)

    if not result.data:
        return None
    return result.data[0]


def _delete_candidate_rows_in_chunks(client: Client, batch_id: str) -> int:
    """Delete candidates by source_batch_id in chunks to avoid lock contention."""
    total_deleted = 0

    while True:
        # Fetch IDs of the next chunk of pending_dedup rows for this batch.
        fetch_result = (
            client.schema(SCHEMA)
            .from_("candidates")
            .select("id")
            .eq("source_batch_id", batch_id)
            .eq("ingestion_state", "pending_dedup")
            .limit(DELETE_CHUNK_SIZE)
            .execute()
        )
        ids = [row["id"] for row in (fetch_result.data or [])]
        if not ids:
            break

        del_result = client.schema(SCHEMA).from_("candidates").delete().in_("id", ids).execute()
        if hasattr(del_result, "error") and del_result.error:
            _log("error", "delete_candidates", batchId=batch_id, error=str(del_result.error))
            sys.exit(1)
        total_deleted += len(ids)

        _log("info", "candidates_chunk_deleted", batchId=batch_id,
             chunkDeleted=len(ids), totalDeleted=total_deleted)

        if len(ids) < DELETE_CHUNK_SIZE:
            break

    return total_deleted


def _delete_row_errors(client: Client, batch_id: str) -> int:
    total_deleted = 0

    while True:
        fetch_result = (
            client.schema(SCHEMA)
            .from_("import_row_error")
            .select("id")
            .eq("batch_id", batch_id)
            .limit(DELETE_CHUNK_SIZE)
            .execute()
        )
        ids = [row["id"] for row in (fetch_result.data or [])]
        if not ids:
            break

        del_result = client.schema(SCHEMA).from_("import_row_error").delete().in_("id", ids).execute()
        if hasattr(del_result, "error") and del_result.error:
            _log("error", "delete_row_errors", batchId=batch_id, error=str(del_result.error))
            sys.exit(1)
        total_deleted += len(ids)

        _log("info", "row_errors_chunk_deleted", batchId=batch_id,
             chunkDeleted=len(ids), totalDeleted=total_deleted)

        if len(ids) < DELETE_CHUNK_SIZE:
            break

    return total_deleted


def _mark_batch_rolled_back(client: Client, batch_id: str) -> None:
    result = client.schema(SCHEMA).from_("import_batch").update(
        {"status": "rolled_back"}
    ).eq("id", batch_id).execute()
    if hasattr(result, "error") and result.error:
        _log("error", "mark_rolled_back", batchId=batch_id, error=str(result.error))
        sys.exit(1)
    _log("info", "mark_rolled_back", batchId=batch_id)


def run_rollback(batch_id: str) -> None:
    _validate_config()
    client = _build_client()
    start_time = time.monotonic()

    batch = _fetch_batch(client, batch_id)
    if batch is None:
        _log("error", "batch_not_found", batchId=batch_id)
        sys.exit(1)

    if batch["status"] == "rolled_back":
        _log("info", "already_rolled_back", batchId=batch_id)
        return

    if batch["status"] == "running":
        # Refuse to roll back a mid-flight batch: the migration script is actively writing
        # candidates, so a concurrent delete races against active inserts and can leave
        # orphaned rows. Stop the Render job first, then roll back.
        _log("error", "batch_is_running", batchId=batch_id, status=batch["status"],
             error="Batch is currently running. Stop the migration job before rolling back.")
        sys.exit(1)

    _log("info", "rollback_started", batchId=batch_id, status=batch["status"])

    deleted_candidates = _delete_candidate_rows_in_chunks(client, batch_id)
    deleted_errors = _delete_row_errors(client, batch_id)
    _mark_batch_rolled_back(client, batch_id)

    elapsed = round(time.monotonic() - start_time, 2)
    _log("info", "rollback_complete", batchId=batch_id,
         candidatesDeleted=deleted_candidates, rowErrorsDeleted=deleted_errors,
         durationMs=int(elapsed * 1000))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rollback a CBLAero import batch")
    parser.add_argument("--batch-id", required=True, help="UUID of the import_batch to roll back")
    args = parser.parse_args()
    run_rollback(args.batch_id)
