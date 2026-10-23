# Phoenix Exporter
Exports phoenix OTEL to local phoenix instance

## Instructions
1. Locate app install path and local phoenix instance
2. Go to `<install path>/phoenix`
3. Run `uv run export_traces.py --source "<workspace>/phoenix" --endpoint "<local phoenix URL>/v1/traces"`

Replace the placeholders with the actual paths and URL. No path is built into the
exporter. `uv` installs the script's Python dependencies automatically.

In a development checkout, the install path is the EdU repository root. Packaged
apps include this folder alongside their resources, outside `app.asar`; on macOS,
look inside the app bundle's `Contents/Resources/phoenix`. EdU also copies the
exporter and this README into the active workspace's `phoenix/` directory. From
that copy, omit `--source` to read the current directory.

Find the active workspace through EdU's topic folder button: it opens
`<workspace>/topics/<topic-id>`. The `phoenix/` directory is beside `topics/`.
The workspace belongs to Electron's user-data directory, or the configured
development/test data directory; moving the app does not hardcode a new location.

The app writes standard OTLP/HTTP protobuf requests as `*.otlp` files. Phoenix
does not need to be running while tutoring. Uploads happen only when this script
is run. Original files are retained. A `.phoenix-export.sqlite3` checkpoint skips
successful uploads to the same endpoint. Failed or partially rejected requests
remain pending. If an instance is reset at the same URL, use `--force` to replay.
A process interruption after server acceptance but before checkpointing can also
cause a replay; the original trace and span IDs are preserved.

Use `--dry-run` to validate without uploading, `--state-file` to put checkpoints
elsewhere, and `--timeout` to change the HTTP timeout. Traces include turn, agent,
tool, validation, recovery, and commit metadata. They exclude prompts, tool
arguments, replies, private answer keys, and credentials.

## Local Phoenix

From this directory, start a separate instance with a unique project name:

```sh
docker compose -p edu-phoenix -f compose.yaml up -d --wait
docker compose -p edu-phoenix -f compose.yaml port phoenix 6006
```

Docker chooses an available localhost port. Use the returned address as the
Phoenix UI URL, and add `/v1/traces` for the collector endpoint. Each project name
gets its own persistent volume. Stop the instance without deleting its data:

```sh
docker compose -p edu-phoenix -f compose.yaml down
```

The official Phoenix image is pinned by digest. No cloud account or model API key
is required. See [Phoenix Docker deployment](https://arize.com/docs/phoenix/self-hosting/deployment-options/docker).

## Exporter tests

```sh
uv run --with opentelemetry-proto python -m unittest discover -s tests
```
