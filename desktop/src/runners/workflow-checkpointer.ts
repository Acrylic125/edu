import { chmodSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { deserialize, serialize } from "node:v8"
import { MemorySaver } from "@langchain/langgraph-checkpoint"
import { z } from "zod"

const BytesSchema = z.instanceof(Uint8Array)
const SavedCheckpointSchema = z.object({
  storage: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.tuple([BytesSchema, BytesSchema, z.string().optional()])))),
  writes: z.record(z.string(), z.record(z.string(), z.tuple([z.string(), z.string(), BytesSchema, z.string().optional()]))),
})

// Reuse LangGraph's serializer and pending-write semantics without adding an Electron native addon.
export class SqliteCheckpointSaver extends MemorySaver {
  private database: DatabaseSync

  constructor(path: string) {
    super()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(path)
    chmodSync(path, 0o600)
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS checkpoints (id INTEGER PRIMARY KEY CHECK(id = 1), payload BLOB NOT NULL) STRICT;")
    const row = this.database.prepare("SELECT payload FROM checkpoints WHERE id = 1").get()
    if (row) {
      const { payload } = z.object({ payload: BytesSchema }).parse(row)
      const saved = SavedCheckpointSchema.parse(deserialize(payload))
      for (const [threadId, namespaces] of Object.entries(saved.storage)) {
        this.storage[threadId] = {}
        for (const [namespace, checkpoints] of Object.entries(namespaces)) {
          this.storage[threadId][namespace] = {}
          for (const [id, [checkpoint, metadata, parent]] of Object.entries(checkpoints))
            this.storage[threadId][namespace][id] = [checkpoint, metadata, parent]
        }
      }
      this.writes = saved.writes
    }
  }

  private persist() {
    this.database.prepare("INSERT INTO checkpoints(id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload")
      .run(serialize({ storage: this.storage, writes: this.writes }))
  }

  override async put(...args: Parameters<MemorySaver["put"]>) {
    const config = await super.put(...args)
    this.persist()
    return config
  }

  override async putWrites(...args: Parameters<MemorySaver["putWrites"]>) {
    await super.putWrites(...args)
    this.persist()
  }

  override async deleteThread(threadId: string) {
    await super.deleteThread(threadId)
    this.persist()
  }

  close() {
    this.database.close()
  }
}
