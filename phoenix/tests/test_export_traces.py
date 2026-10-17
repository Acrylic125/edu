import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)

from export_traces import export_traces


class ExporterTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = Path(self.directory.name) / "relocated app" / "phoenix"
        self.source.mkdir(parents=True)
        request = ExportTraceServiceRequest()
        span = request.resource_spans.add().scope_spans.add().spans.add()
        span.trace_id = bytes.fromhex("12" * 16)
        span.span_id = bytes.fromhex("34" * 8)
        span.name = "synthetic-agent"
        span.start_time_unix_nano = 1
        span.end_time_unix_nano = 2
        self.payload = request.SerializeToString()
        (self.source / "trace.otlp").write_bytes(self.payload)
        self.requests = []
        self.response = ExportTraceServiceResponse()
        self.status = 200
        self.content_type = "application/x-protobuf"
        self.response_bytes = None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                owner.requests.append((self.path, self.headers["Content-Type"], self.rfile.read(int(self.headers["Content-Length"]))))
                self.send_response(owner.status)
                self.send_header("Content-Type", owner.content_type)
                self.end_headers()
                self.wfile.write(owner.response.SerializeToString() if owner.response_bytes is None else owner.response_bytes)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}"

    def test_uploads_exact_otlp_and_checkpoints_per_endpoint(self):
        self.assertEqual(export_traces(self.source, self.endpoint), (1, 0))
        self.assertEqual(self.requests, [("/v1/traces", "application/x-protobuf", self.payload)])
        self.assertEqual(export_traces(self.source, self.endpoint + "/v1/traces"), (0, 1))
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(export_traces(self.source, self.endpoint + "/another-instance"), (1, 0))
        self.assertEqual(len(self.requests), 2)

    def test_partial_rejection_is_not_checkpointed(self):
        self.response.partial_success.rejected_spans = 1
        with self.assertRaisesRegex(RuntimeError, "rejected"):
            export_traces(self.source, self.endpoint)
        self.response.Clear()
        self.assertEqual(export_traces(self.source, self.endpoint), (1, 0))

    def test_http_failure_is_not_checkpointed(self):
        self.status = 503
        with self.assertRaisesRegex(RuntimeError, "503"):
            export_traces(self.source, self.endpoint)
        self.status = 200
        self.assertEqual(export_traces(self.source, self.endpoint), (1, 0))

    def test_force_replays_successful_upload(self):
        export_traces(self.source, self.endpoint)
        self.assertEqual(export_traces(self.source, self.endpoint, force=True), (1, 0))
        self.assertEqual(len(self.requests), 2)

    def test_dry_run_validates_without_network_or_checkpoint(self):
        self.assertEqual(export_traces(self.source, self.endpoint, dry_run=True), (1, 0))
        self.assertEqual(self.requests, [])
        self.assertFalse((self.source / ".phoenix-export.sqlite3").exists())

    def test_corrupt_or_empty_protobuf_never_reaches_collector(self):
        for payload in [b"corrupt", b""]:
            (self.source / "trace.otlp").write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "OTLP"):
                export_traces(self.source, self.endpoint)
        self.assertEqual(self.requests, [])

    def test_missing_source_and_invalid_endpoint_fail_clearly(self):
        with self.assertRaisesRegex(ValueError, "directory"):
            export_traces(self.source / "missing", self.endpoint)
        with self.assertRaisesRegex(ValueError, "HTTP"):
            export_traces(self.source, "file:///tmp/phoenix")

    def test_non_otlp_success_response_is_not_checkpointed(self):
        self.content_type = "text/html"
        with self.assertRaisesRegex(RuntimeError, "OTLP"):
            export_traces(self.source, self.endpoint)
        self.content_type = "application/x-protobuf"
        self.assertEqual(export_traces(self.source, self.endpoint), (1, 0))

    def test_malformed_json_response_has_a_concise_retryable_error(self):
        self.content_type = "application/json"
        self.response_bytes = b"{"
        with self.assertRaisesRegex(RuntimeError, "invalid OTLP"):
            export_traces(self.source, self.endpoint)


if __name__ == "__main__":
    unittest.main()
