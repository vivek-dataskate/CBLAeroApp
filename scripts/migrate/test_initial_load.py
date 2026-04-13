import unittest
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import initial_load


class _FakeSchemaClient:
    def __init__(self, rpc_data=None, rpc_error: Exception | None = None):
        self.rpc_data = rpc_data if rpc_data is not None else [{"imported": 1, "errors": 2}]
        self.rpc_error = rpc_error
        self.last_rpc_name = None
        self.last_rpc_payload = None

    def rpc(self, name, payload):
        self.last_rpc_name = name
        self.last_rpc_payload = payload
        if self.rpc_error is not None:
            raise self.rpc_error
        return self

    def execute(self):
        return SimpleNamespace(data=self.rpc_data)


class _FakeClient:
    def __init__(self, schema_client: _FakeSchemaClient):
        self.schema_client = schema_client

    def schema(self, _schema_name):
        return self.schema_client


class ProcessChunkTests(unittest.TestCase):
    def test_process_chunk_counts_imported_and_errors(self) -> None:
        chunk = [
            {"name": "Jane", "email": "jane@example.com"},
            {"name": "", "email": "missing-name@example.com"},
            {"name": "No Identity", "email": "", "phone": ""},
        ]

        schema_client = _FakeSchemaClient(rpc_data=[{"imported": 1, "errors": 2}])
        imported, errors = initial_load._process_chunk(
            client=_FakeClient(schema_client),
            chunk=chunk,
            chunk_num=1,
            base_row=1,
            batch_id="batch-1",
            total_imported=0,
            total_skipped=0,
            total_errors=0,
        )

        self.assertEqual(imported, 1)
        self.assertEqual(errors, 2)
        self.assertEqual(schema_client.last_rpc_name, "process_import_chunk")
        payload = schema_client.last_rpc_payload
        self.assertEqual(payload["p_batch_id"], "batch-1")
        self.assertEqual(payload["p_total_imported"], 0)
        self.assertEqual(payload["p_total_errors"], 0)
        self.assertEqual(len(payload["p_candidates"]), 1)
        self.assertEqual(payload["p_candidates"][0]["row_number"], 1)
        self.assertIn("raw_data", payload["p_candidates"][0])
        self.assertEqual(len(payload["p_error_rows"]), 2)

    def test_process_chunk_raises_when_rpc_fails(self) -> None:
        chunk = [
            {"name": "Jane", "email": "jane@example.com"},
            {"name": "John", "phone": "+15550001111"},
            {"name": "", "email": "missing-name@example.com"},
        ]

        schema_client = _FakeSchemaClient(rpc_error=RuntimeError("boom"))
        with self.assertRaises(RuntimeError):
            initial_load._process_chunk(
                client=_FakeClient(schema_client),
                chunk=chunk,
                chunk_num=2,
                base_row=1,
                batch_id="batch-2",
                total_imported=0,
                total_skipped=0,
                total_errors=0,
            )


class ErrorThresholdGuardTests(unittest.TestCase):
    def test_chunk_error_rate_exceeded_true_when_over_threshold(self) -> None:
        with patch.object(initial_load, "ERROR_THRESHOLD_PCT", 5.0):
            self.assertTrue(initial_load._chunk_error_rate_exceeded(chunk_errors=51, chunk_size=1000))

    def test_chunk_error_rate_exceeded_false_at_threshold(self) -> None:
        with patch.object(initial_load, "ERROR_THRESHOLD_PCT", 5.0):
            self.assertFalse(initial_load._chunk_error_rate_exceeded(chunk_errors=50, chunk_size=1000))


if __name__ == "__main__":
    unittest.main()
