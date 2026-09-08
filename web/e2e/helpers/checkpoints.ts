import { createHash } from "node:crypto"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

const ROOT = path.resolve(process.cwd(), ".e2e")
export const CHECKPOINT_ROOT = path.join(ROOT, "checkpoints")
export const RUN_ROOT = path.join(ROOT, "runs")

export const CHECKPOINT_GRAPH = {
  FRESH: null,
  SETUP_PLAN_TOC: "FRESH",
  SUBTOPIC_1: "SETUP_PLAN_TOC",
  SETUP_PLAN_CALCULUS: "SUBTOPIC_1",
} as const

export type CheckpointName = keyof typeof CHECKPOINT_GRAPH

export type CheckpointManifest = {
  name: CheckpointName
  parent: CheckpointName | null
  formatVersion: 1
  migrationHash: string
  setupHash: string
  createdAt: string
  sourceCommit: string
}

const CheckpointManifestSchema = z.object({
  name: z.enum(["FRESH", "SETUP_PLAN_TOC", "SUBTOPIC_1", "SETUP_PLAN_CALCULUS"]),
  parent: z.enum(["FRESH", "SETUP_PLAN_TOC", "SUBTOPIC_1", "SETUP_PLAN_CALCULUS"]).nullable(),
  formatVersion: z.literal(1),
  migrationHash: z.string(),
  setupHash: z.string(),
  createdAt: z.string(),
  sourceCommit: z.string(),
})

function checkpointDir(name: CheckpointName) {
  return path.join(CHECKPOINT_ROOT, name)
}

export function checkpointStateDir(name: CheckpointName) {
  return path.join(checkpointDir(name), "state")
}

export function checkpointBrowserStatePath(name: CheckpointName) {
  return path.join(checkpointDir(name), "storage-state.json")
}

export function checkpointManifestPath(name: CheckpointName) {
  return path.join(checkpointDir(name), "manifest.json")
}

export async function checkpointExists(name: CheckpointName) {
  try {
    await readFile(checkpointManifestPath(name), "utf8")
    return true
  } catch {
    return false
  }
}

export async function readCheckpointManifest(name: CheckpointName) {
  return CheckpointManifestSchema.parse(JSON.parse(await readFile(checkpointManifestPath(name), "utf8")))
}

export async function cloneCheckpoint(name: CheckpointName, destination: string) {
  await cp(checkpointStateDir(name), destination, { recursive: true })
  return readCheckpointManifest(name)
}

export async function saveCheckpoint(
  name: CheckpointName,
  stateDir: string,
  storageStatePath: string,
  manifest: CheckpointManifest,
) {
  const target = checkpointDir(name)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(stateDir, checkpointStateDir(name), { recursive: true })
  await cp(storageStatePath, checkpointBrowserStatePath(name))
  await writeFile(checkpointManifestPath(name), `${JSON.stringify(manifest, null, 2)}\n`)
}

export async function resetCheckpoints() {
  const normalized = path.resolve(CHECKPOINT_ROOT)
  if (!normalized.endsWith(`${path.sep}checkpoints`)) {
    throw new Error(`Refusing to reset unexpected checkpoint path: ${normalized}`)
  }
  await rm(normalized, { recursive: true, force: true })
}

export async function ensureRunRoot(runId: string) {
  const destination = path.join(RUN_ROOT, runId)
  await mkdir(destination, { recursive: true })
  return destination
}

export function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
