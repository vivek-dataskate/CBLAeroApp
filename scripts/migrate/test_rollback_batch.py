import unittest
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import rollback_batch


class _FakeQueryBuilder:
    """Chainable mock that mimics supabase-py's query builder pattern."""

    def __init__(self, data=None):
        self._data = data if data is not None else []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, _col, _val):
        return self

    def limit(self, _n):
        return self

    def delete(self):
        return self

    def in_(self, _col, _ids):
        return self

    def update(self, _payload):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data)


class _FakeSchemaClient:
    """Routes from_() calls to per-table query builders."""

    def __init__(self, tables: dict[str, list[_FakeQueryBuilder]] | None = None):
        self._tables = tables or {}
        self._call_counts: dict[str, int] = {}

    def from_(self, table: str):
        self._call_counts.setdefault(table, 0)
        builders = self._tables.get(table, [_FakeQueryBuilder()])
        idx = min(self._call_counts[table], len(builders) - 1)
        self._call_counts[table] += 1
        return builders[idx]


class _FakeClient:
    def __init__(self, schema_client: _FakeSchemaClient):
        self._schema_client = schema_client

    def schema(self, _name):
        return self._schema_client


class FetchBatchTests(unittest.TestCase):
    def test_returns_none_when_batch_not_found(self) -> None:
        client = _FakeClient(_FakeSchemaClient({"import_batch": [_FakeQueryBuilder([])]}))
        result = rollback_batch._fetch_batch(client, "nonexistent-uuid")
        self.assertIsNone(result)

    def test_returns_batch_when_found(self) -> None:
        batch = {"id": "batch-1", "status": "complete", "imported": 100, "tenant_id": "t1"}
        client = _FakeClient(_FakeSchemaClient({"import_batch": [_FakeQueryBuilder([batch])]}))
        result = rollback_batch._fetch_batch(client, "batch-1")
        self.assertEqual(result["id"], "batch-1")
        self.assertEqual(result["status"], "complete")


class RunRollbackTests(unittest.TestCase):
    @patch.object(rollback_batch, "SUPABASE_URL", "https://fake.supabase.co")
    @patch.object(rollback_batch, "SUPABASE_SERVICE_ROLE_KEY", "fake-key")
    @patch.object(rollback_batch, "_build_client")
    def test_exits_when_batch_not_found(self, mock_build):
        mock_build.return_value = _FakeClient(
            _FakeSchemaClient({"import_batch": [_FakeQueryBuilder([])]})
        )
        with self.assertRaises(SystemExit) as ctx:
            rollback_batch.run_rollback("nonexistent-uuid")
        self.assertEqual(ctx.exception.code, 1)

    @patch.object(rollback_batch, "SUPABASE_URL", "https://fake.supabase.co")
    @patch.object(rollback_batch, "SUPABASE_SERVICE_ROLE_KEY", "fake-key")
    @patch.object(rollback_batch, "_build_client")
    def test_exits_when_batch_is_running(self, mock_build):
        batch = {"id": "batch-1", "status": "running", "imported": 50, "tenant_id": "t1"}
        mock_build.return_value = _FakeClient(
            _FakeSchemaClient({"import_batch": [_FakeQueryBuilder([batch])]})
        )
        with self.assertRaises(SystemExit) as ctx:
            rollback_batch.run_rollback("batch-1")
        self.assertEqual(ctx.exception.code, 1)

    @patch.object(rollback_batch, "SUPABASE_URL", "https://fake.supabase.co")
    @patch.object(rollback_batch, "SUPABASE_SERVICE_ROLE_KEY", "fake-key")
    @patch.object(rollback_batch, "_build_client")
    def test_noop_when_already_rolled_back(self, mock_build):
        batch = {"id": "batch-1", "status": "rolled_back", "imported": 0, "tenant_id": "t1"}
        mock_build.return_value = _FakeClient(
            _FakeSchemaClient({"import_batch": [_FakeQueryBuilder([batch])]})
        )
        # Should return without error (no SystemExit)
        rollback_batch.run_rollback("batch-1")


class DeleteCandidateRowsTests(unittest.TestCase):
    def test_deletes_in_chunks_and_returns_total(self) -> None:
        # First call returns 2 IDs (< chunk size), so loop exits after one iteration
        candidates_builders = [
            _FakeQueryBuilder([{"id": "c1"}, {"id": "c2"}]),  # select
            _FakeQueryBuilder([]),  # delete
        ]
        client = _FakeClient(_FakeSchemaClient({"candidates": candidates_builders}))

        with patch.object(rollback_batch, "DELETE_CHUNK_SIZE", 10_000):
            deleted = rollback_batch._delete_candidate_rows_in_chunks(client, "batch-1")

        self.assertEqual(deleted, 2)

    def test_returns_zero_when_no_candidates(self) -> None:
        client = _FakeClient(_FakeSchemaClient({"candidates": [_FakeQueryBuilder([])]}))
        deleted = rollback_batch._delete_candidate_rows_in_chunks(client, "batch-1")
        self.assertEqual(deleted, 0)


class DeleteRowErrorsTests(unittest.TestCase):
    def test_deletes_errors_in_chunks(self) -> None:
        error_builders = [
            _FakeQueryBuilder([{"id": 1}, {"id": 2}, {"id": 3}]),  # select
            _FakeQueryBuilder([]),  # delete
        ]
        client = _FakeClient(_FakeSchemaClient({"import_row_error": error_builders}))

        with patch.object(rollback_batch, "DELETE_CHUNK_SIZE", 10_000):
            deleted = rollback_batch._delete_row_errors(client, "batch-1")

        self.assertEqual(deleted, 3)

    def test_returns_zero_when_no_errors(self) -> None:
        client = _FakeClient(_FakeSchemaClient({"import_row_error": [_FakeQueryBuilder([])]}))
        deleted = rollback_batch._delete_row_errors(client, "batch-1")
        self.assertEqual(deleted, 0)


if __name__ == "__main__":
    unittest.main()
