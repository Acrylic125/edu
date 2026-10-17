# /// script
# requires-python = ">=3.11"
# dependencies = ["opentelemetry-proto>=1.39,<2"]
# ///
"""Replay EdU's OTLP protobuf files into a Phoenix HTTP collector."""

import argparse
from contextlib import closing
import hashlib
from pathlib import Path
import sqlite3
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from google.protobuf.json_format import Parse, ParseError
from google.protobuf.message import DecodeError
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)


def collector_endpoint(value: str):
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("The Phoenix endpoint must be an HTTP or HTTPS URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Use a collector URL without credentials, query, or fragment.")
    path = parsed.path.rstrip("/")
    if not path.endswith("/v1/traces"):
        path += "/v1/traces"
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def read_otlp(path: Path):
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError(f"OTLP file exceeds the 32 MiB limit: {path.name}")
    body = path.read_bytes()
    try:
        request = ExportTraceServiceRequest.FromString(body)
    except DecodeError as error:
        raise ValueError(f"Invalid OTLP protobuf: {path.name}") from error
    spans = [span for resource in request.resource_spans for scope in resource.scope_spans for span in scope.spans]
    if not spans or any(len(span.trace_id) != 16 or len(span.span_id) != 8 for span in spans):
        raise ValueError(f"OTLP file has no valid trace spans: {path.name}")
    return body


def upload(body: bytes, endpoint: str, timeout: float):
    request = Request(endpoint, data=body, headers={"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise RuntimeError(f"Phoenix returned HTTP {response.status}; the file remains pending.")
            reply = response.read(1024 * 1024)
            result = ExportTraceServiceResponse()
            media_type = response.headers.get_content_type()
            if media_type == "application/json":
                Parse(reply.decode("utf8"), result)
            elif media_type == "application/x-protobuf":
                result.ParseFromString(reply)
            else:
                raise RuntimeError("Phoenix returned a non-OTLP response; the file remains pending.")
            if result.partial_success.rejected_spans or result.partial_success.error_message:
                raise RuntimeError("Phoenix rejected all or part of this OTLP request; the file remains pending.")
    except HTTPError as error:
        raise RuntimeError(f"Phoenix returned HTTP {error.code}; the file remains pending.") from error
    except (URLError, TimeoutError, OSError) as error:
        raise RuntimeError("Could not reach Phoenix; check the endpoint and try again.") from error
    except (DecodeError, ParseError, ValueError) as error:
        raise RuntimeError("Phoenix returned an invalid OTLP response; the file remains pending.") from error


def export_traces(source: Path, endpoint: str, *, force=False, dry_run=False, timeout=30.0, state_file: Path | None = None):
    source = source.expanduser().resolve()
    if not source.is_dir():
        raise ValueError("The trace source must be an existing directory.")
    endpoint = collector_endpoint(endpoint)
    files = sorted(source.rglob("*.otlp"))
    if dry_run:
        for path in files:
            read_otlp(path)
        return len(files), 0
    state_file = state_file or source / ".phoenix-export.sqlite3"
    exported = 0
    skipped = 0
    with closing(sqlite3.connect(state_file, timeout=30)) as database:
        database.execute("CREATE TABLE IF NOT EXISTS uploads (endpoint TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(endpoint, digest))")
        database.commit()
        for path in files:
            body = read_otlp(path)
            digest = hashlib.sha256(body).hexdigest()
            # Serialize concurrent exporters so they cannot both upload an unchecked file.
            with database:
                database.execute("BEGIN IMMEDIATE")
                existing = database.execute("SELECT 1 FROM uploads WHERE endpoint = ? AND digest = ?", (endpoint, digest)).fetchone()
                if existing and not force:
                    skipped += 1
                    continue
                upload(body, endpoint, timeout)
                database.execute("INSERT OR IGNORE INTO uploads(endpoint, digest) VALUES (?, ?)", (endpoint, digest))
                exported += 1
    return exported, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path.cwd(), help="Directory containing EdU OTLP files (default: current directory)")
    parser.add_argument("--endpoint", required=True, help="Phoenix base URL or full /v1/traces HTTP collector URL")
    parser.add_argument("--state-file", type=Path, help="Override the replay checkpoint location")
    parser.add_argument("--force", action="store_true", help="Resend files already uploaded to this endpoint")
    parser.add_argument("--dry-run", action="store_true", help="Validate files without uploading or recording checkpoints")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds")
    arguments = parser.parse_args()
    if arguments.timeout <= 0:
        parser.error("--timeout must be positive")
    try:
        exported, skipped = export_traces(arguments.source, arguments.endpoint, force=arguments.force,
            dry_run=arguments.dry_run, timeout=arguments.timeout, state_file=arguments.state_file)
    except (ValueError, RuntimeError, OSError, sqlite3.Error) as error:
        parser.exit(1, f"Export failed: {error}\n")
    verb = "Validated" if arguments.dry_run else "Exported"
    print(f"{verb} {exported} OTLP files; skipped {skipped} previously exported files.")


if __name__ == "__main__":
    main()
