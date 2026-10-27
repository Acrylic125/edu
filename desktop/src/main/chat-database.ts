import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { ChatSchema, MessageSchema, WorkspaceSchema, type Workspace } from "../shared/contracts"
import { StoredJsonSchema, StoredTopicSchema, StoredWorkspaceSchema } from "./workspace-migrations"
import { ConversationSummarySchema, WorkflowRecordSchema } from "../shared/tutor-workflow"

const ChatStateSchema = ChatSchema.omit({ messages: true })
const SettingsSchema = WorkspaceSchema.pick({ runners: true, providerSettings: true })
const RemovedFilesSchema = z.object({ scratchpads: z.array(z.string().uuid()), chats: z.array(z.string().uuid()) })
const JsonRowSchema = z.object({ payload: z.string() })

export class ChatDatabase {
  constructor(readonly path: string) {}

  private open() {
    const database = new DatabaseSync(this.path)
    try {
      database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;")
      const version = z.object({ user_version: z.number() }).parse(database.prepare("PRAGMA user_version").get()).user_version
      if (version > 2) throw new Error("This workspace needs a newer version of EdU.")
      database.exec(`
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS tutor_workflows (id TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL,
          payload TEXT NOT NULL,
          UNIQUE(chat_id, ordinal)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS events_entity_sequence ON events(entity_id, sequence);
      `)
      if (version < 2) {
        database.exec("BEGIN IMMEDIATE")
        try {
          for (const [table, key] of [["metadata", "key"], ["chats", "id"], ["messages", "id"], ["tutor_workflows", "id"]]) {
            const rows = database.prepare(`SELECT ${key} AS id, payload FROM ${table}`).all()
            const update = database.prepare(`UPDATE ${table} SET payload = ? WHERE ${key} = ?`)
            for (const row of rows) {
              const stored = z.object({ id: z.string(), payload: z.string() }).parse(row)
              update.run(JSON.stringify(StoredJsonSchema.parse(JSON.parse(stored.payload))), stored.id)
            }
          }
          database.exec("UPDATE metadata SET key = 'scratchpads' WHERE key = 'topics'; PRAGMA user_version = 2; COMMIT;")
        } catch (error) {
          database.exec("ROLLBACK")
          throw error
        }
      }
      return database
    } catch (error) {
      database.close()
      throw error
    }
  }

  load() {
    const database = this.open()
    try {
      const row = database.prepare("SELECT payload FROM metadata WHERE key = 'settings'").get()
      if (!row) {
        const existing = database.prepare("SELECT 1 AS present FROM metadata UNION ALL SELECT 1 FROM chats UNION ALL SELECT 1 FROM events LIMIT 1").get()
        if (existing) throw new Error("The chat database is incomplete. Restore it from a backup.")
        return null
      }
      const settings = SettingsSchema.parse(JSON.parse(JsonRowSchema.parse(row).payload))
      const chats = database.prepare("SELECT payload FROM chats").all().map((row) => {
        const chat = ChatStateSchema.parse(JSON.parse(JsonRowSchema.parse(row).payload))
        const messages = database.prepare("SELECT payload FROM messages WHERE chat_id = ? ORDER BY ordinal").all(chat.id)
          .map((row) => MessageSchema.parse(JSON.parse(JsonRowSchema.parse(row).payload)))
        return ChatSchema.parse({ ...chat, messages })
      }).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
      const scratchpads = JsonRowSchema.parse(database.prepare("SELECT payload FROM metadata WHERE key = 'scratchpads'").get())
      const pending = JsonRowSchema.parse(database.prepare("SELECT payload FROM metadata WHERE key = 'files_pending'").get())
      return {
        state: StoredWorkspaceSchema.parse({ version: 2, ...settings, chats, scratchpads: JSON.parse(scratchpads.payload) }),
        needsMigration: !WorkspaceSchema.shape.scratchpads.safeParse(JSON.parse(scratchpads.payload)).success,
        filesPending: pending.payload === "true",
        removedFiles: RemovedFilesSchema.parse(JSON.parse(JsonRowSchema.parse(database.prepare("SELECT payload FROM metadata WHERE key = 'removed_files'").get()).payload)),
      }
    } finally {
      database.close()
    }
  }

  scratchpadFromHistory(id: string) {
    const database = this.open()
    try {
      const row = database.prepare(`
        SELECT scratchpad.value AS payload
        FROM events AS history, json_each(history.payload) AS scratchpad
        WHERE history.type IN ('scratchpads.updated', 'topics.updated')
          AND instr(history.payload, ?) > 0
          AND json_extract(scratchpad.value, '$.id') = ?
        ORDER BY history.sequence DESC
        LIMIT 1
      `).get(id, id)
      if (!row) return
      return StoredTopicSchema.parse(StoredJsonSchema.parse(JSON.parse(JsonRowSchema.parse(row).payload)))
    } finally {
      database.close()
    }
  }

  save(state: Workspace, workflow?: z.infer<typeof WorkflowRecordSchema>) {
    const validated = WorkspaceSchema.parse(state)
    const database = this.open()
    try {
      database.exec("BEGIN IMMEDIATE")
      const metadata = database.prepare("INSERT INTO metadata(key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload")
      const event = database.prepare("INSERT INTO events(entity_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
      const now = new Date().toISOString()
      const oldTopicsRow = database.prepare("SELECT payload FROM metadata WHERE key = 'scratchpads'").get()
      let oldTopics: Workspace["scratchpads"] = []
      if (oldTopicsRow) oldTopics = StoredWorkspaceSchema.shape.scratchpads.parse(JSON.parse(JsonRowSchema.parse(oldTopicsRow).payload))
      const removedFiles = RemovedFilesSchema.parse({ scratchpads: oldTopics.filter((scratchpad) => !validated.scratchpads.some((item) => item.id === scratchpad.id)).map((scratchpad) => scratchpad.id), chats: [] })
      for (const chat of validated.chats) {
        const existing = database.prepare("SELECT payload FROM chats WHERE id = ?").get(chat.id)
        const { messages, ...header } = chat
        const payload = JSON.stringify(header)
        if (!existing || JsonRowSchema.parse(existing).payload !== payload) {
          database.prepare("INSERT INTO chats(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").run(chat.id, payload)
          event.run(chat.id, "chat.updated", payload, now)
        }
        const stored = database.prepare("SELECT id, payload FROM messages WHERE chat_id = ? ORDER BY ordinal").all(chat.id)
          .map((row) => z.object({ id: z.string(), payload: z.string() }).parse(row))
        if (JSON.stringify(stored.map((row) => row.payload)) !== JSON.stringify(messages.map((message) => JSON.stringify(message)))) {
          database.prepare("DELETE FROM messages WHERE chat_id = ?").run(chat.id)
          for (const [ordinal, message] of messages.entries()) {
            const payload = JSON.stringify(message)
            database.prepare("INSERT INTO messages(id, chat_id, ordinal, payload) VALUES (?, ?, ?, ?)").run(message.id, chat.id, ordinal, payload)
            if (stored.find((row) => row.id === message.id)?.payload !== payload)
              event.run(chat.id, "message.updated", payload, now)
          }
          for (const message of stored) {
            if (!messages.some((item) => item.id === message.id))
              event.run(chat.id, "message.deleted", JSON.stringify({ id: message.id }), now)
          }
        }
      }
      for (const row of database.prepare("SELECT id FROM chats").all()) {
        const { id } = z.object({ id: z.string() }).parse(row)
        if (!validated.chats.some((chat) => chat.id === id)) {
          removedFiles.chats.push(id)
          database.prepare("DELETE FROM chats WHERE id = ?").run(id)
          event.run(id, "chat.deleted", JSON.stringify({ id }), now)
        }
      }
      for (const [key, payload] of [
        ["settings", JSON.stringify(SettingsSchema.parse(validated))],
        ["scratchpads", JSON.stringify(validated.scratchpads)],
      ]) {
        const old = database.prepare("SELECT payload FROM metadata WHERE key = ?").get(key)
        if (!old || JsonRowSchema.parse(old).payload !== payload)
          event.run(key, `${key}.updated`, payload, now)
        metadata.run(key, payload)
      }
      metadata.run("removed_files", JSON.stringify(removedFiles))
      metadata.run("files_pending", "true")
      if (workflow) database.prepare("INSERT INTO tutor_workflows(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload")
        .run(workflow.turnId, JSON.stringify(WorkflowRecordSchema.parse(workflow)))
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    } finally {
      database.close()
    }
  }

  filesSynced() {
    const database = this.open()
    try {
      database.exec("BEGIN IMMEDIATE")
      database.prepare("UPDATE metadata SET payload = 'false' WHERE key = 'files_pending'").run()
      database.prepare("UPDATE metadata SET payload = ? WHERE key = 'removed_files'").run(JSON.stringify({ scratchpads: [], chats: [] }))
      database.exec("COMMIT")
    } finally {
      database.close()
    }
  }

  workflow(turnId: string) {
    const database = this.open()
    try {
      const row = database.prepare("SELECT payload FROM tutor_workflows WHERE id = ?").get(turnId)
      if (!row) throw new Error("Turn not found.")
      return WorkflowRecordSchema.parse(JSON.parse(JsonRowSchema.parse(row).payload))
    } finally {
      database.close()
    }
  }

  saveWorkflow(input: z.infer<typeof WorkflowRecordSchema>, summary?: z.infer<typeof ConversationSummarySchema>) {
    const turn = WorkflowRecordSchema.parse(input)
    const database = this.open()
    try {
      database.exec("BEGIN IMMEDIATE")
      database.prepare("INSERT INTO tutor_workflows(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload")
        .run(turn.turnId, JSON.stringify(turn))
      if (summary) database.prepare("INSERT INTO metadata(key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload")
        .run(`summary:${turn.chatId}`, JSON.stringify(ConversationSummarySchema.parse(summary)))
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    } finally {
      database.close()
    }
  }

  conversationSummary(chatId: string) {
    const database = this.open()
    try {
      const row = database.prepare("SELECT payload FROM metadata WHERE key = ?").get(`summary:${chatId}`)
      if (row) return ConversationSummarySchema.parse(JSON.parse(JsonRowSchema.parse(row).payload))
    } finally {
      database.close()
    }
  }
}
