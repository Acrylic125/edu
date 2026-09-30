import { randomUUID } from "node:crypto"
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { chromium, expect, type Browser } from "@playwright/test"
import { MessagePartsSchema, TopicPlanSchema } from "@edu/chat-contract"
import {
  CHECKPOINT_GRAPH,
  type CheckpointName,
  checkpointBrowserStatePath,
  checkpointExists,
  checkpointStateDir,
  ensureRunRoot,
  hashText,
  saveCheckpoint,
} from "./checkpoints"
import { stopServices, startServices, applyMigrations } from "./services"
import { AUTOMATA_OUTLINE, CALCULUS_OUTLINE } from "../fixtures/outlines"
import { validateMessageParts } from "./validators"

const baseURL = "http://localhost:3100"

async function openApp(page: import("@playwright/test").Page) {
  await page.goto("/chat")
  const topics = page.getByRole("navigation", { name: "Your topics" }).getByRole("link")
  if (await topics.count() > 0) await topics.last().click()
  await page.waitForTimeout(2000)
}

async function signInAsTestUser(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/auth/sign-up/email")),
    page.getByRole("button", { name: "Continue as test user" }).click(),
  ])
  await openApp(page)
  await expect(page.getByRole("heading", { name: "Drop in slides, tutorials and past year papers to learn" })).toBeVisible()
  await page.waitForTimeout(1000)
}

async function createPlan(page: import("@playwright/test").Page, outline: string) {
  await page.getByRole("textbox").fill(outline)
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 60_000 })
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Finite Automata", { exact: false }).first()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByRole("navigation", { name: "Table of contents" })).toBeVisible({ timeout: 180_000 })
  await expect(page).toHaveURL(/\/chat\/topic_[^/]+$/)
}

async function assertTopicPersisted(stateDir: string) {
  const d1Root = path.join(stateDir, "v3", "d1")
  const entries = await readdir(d1Root, { recursive: true })
  const filename = entries.find((entry) => entry.endsWith(".sqlite") && !entry.endsWith("metadata.sqlite"))
  if (!filename) throw new Error(`No D1 sqlite file found under ${d1Root}`)
  const databasePath = path.join(d1Root, filename)
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const count = database.prepare("SELECT count(*) AS count FROM topic").get()
    if (!count || Number(count.count) < 1) throw new Error("Checkpoint setup finished without persisting a topic")
  } finally {
    database.close()
  }
}

function expectedPlan(outline: string) {
  const lines = outline
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0)
    .slice(1)
  const steps = lines.map((line, index) => ({
    index,
    depth: Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 3),
    label: line.replace(/^(?:[-*+]|(?:[IVXLCDM]+|[A-Z]|\d+)[.)])\s+/, "").trim(),
  }))
  return steps.map((step) => {
    let parent: string | null = null
    for (let index = step.index - 1; index >= 0; index -= 1) {
      const candidate = steps[index]
      if (candidate && candidate.depth < step.depth) {
        parent = `step-${candidate.index + 1}`
        break
      }
    }
    return { id: `step-${step.index + 1}`, label: step.label, summary: step.label, parent }
  })
}

async function findDatabasePath(stateDir: string) {
  const d1Root = path.join(stateDir, "v3", "d1")
  const entries = await readdir(d1Root, { recursive: true })
  const filename = entries.find((entry) => entry.endsWith(".sqlite") && !entry.endsWith("metadata.sqlite"))
  if (!filename) throw new Error(`No D1 sqlite file found under ${d1Root}`)
  return path.join(d1Root, filename)
}

async function assertPlanAndResponsesPersisted(stateDir: string, outline: string) {
  const database = new DatabaseSync(await findDatabasePath(stateDir), { readOnly: true })
  try {
    const row = database.prepare("SELECT plan FROM topic ORDER BY created_at DESC LIMIT 1").get()
    if (!row || typeof row.plan !== "string") throw new Error("Checkpoint topic has no JSON plan")
    const actual = TopicPlanSchema.parse(JSON.parse(row.plan))
    const expected = TopicPlanSchema.parse(expectedPlan(outline))
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Persisted plan does not match the supplied outline (${actual.length} vs ${expected.length} steps)`)
    }
    const messages = database.prepare("SELECT parts FROM topic_message WHERE role = 'assistant'").all()
    for (const message of messages) {
      if (typeof message.parts !== "string") throw new Error("Assistant message parts are not JSON")
      const parts = MessagePartsSchema.parse(JSON.parse(message.parts))
      await validateMessageParts(parts, [process.env.OPENROUTER_API_KEY ?? "", process.env.BETTER_AUTH_SECRET ?? ""])
    }
  } finally {
    database.close()
  }
}

async function buildCheckpoint(name: CheckpointName, parent: CheckpointName | null) {
  const runRoot = await ensureRunRoot(`checkpoint-${name}-${randomUUID()}`)
  const stateDir = path.join(runRoot, "state")
  await mkdir(stateDir, { recursive: true })
  if (parent) {
    await cp(checkpointStateDir(parent), stateDir, { recursive: true })
  } else {
    await applyMigrations(stateDir)
  }
  const services = await startServices(stateDir, runRoot)
  const browser = await chromium.launch()
  const storageStatePath = path.join(runRoot, "storage-state.json")
  try {
    const context = await browser.newContext({
      baseURL,
      storageState: parent ? checkpointBrowserStatePath(parent) : undefined,
    })
    const page = await context.newPage()
    if (!parent) {
      await signInAsTestUser(page)
    } else {
      await openApp(page)
      if (name === "SETUP_PLAN_TOC") {
        await createPlan(page, AUTOMATA_OUTLINE)
      } else if (name === "SUBTOPIC_1") {
        await page.waitForTimeout(5000)
        await expect(page.getByRole("button", { name: /Explain/ }).first()).toBeEnabled({ timeout: 60_000 })
        await page.getByRole("button", { name: /Explain/ }).first().click()
        await expect(page.getByRole("button", { name: /Practice/ })).toBeVisible({ timeout: 180_000 })
      } else if (name === "SETUP_PLAN_CALCULUS") {
        await page.getByRole("link", { name: "New topic", exact: true }).click()
        await page.getByRole("textbox").fill(CALCULUS_OUTLINE)
        await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 60_000 })
        await page.getByRole("button", { name: "Send" }).click()
        await expect(page.getByText("Limits and Continuity", { exact: false }).first()).toBeVisible({ timeout: 180_000 })
        await expect(page.getByRole("navigation", { name: "Table of contents" })).toBeVisible({ timeout: 180_000 })
        await expect(page).toHaveURL(/\/chat\/topic_[^/]+$/)
      }
    }
    await context.storageState({ path: storageStatePath })
    await context.close()
  } finally {
    await browser.close()
    await stopServices(services)
  }

  if (name !== "FRESH") {
    await assertTopicPersisted(stateDir)
    if (name === "SETUP_PLAN_TOC") await assertPlanAndResponsesPersisted(stateDir, AUTOMATA_OUTLINE)
    if (name === "SETUP_PLAN_CALCULUS") await assertPlanAndResponsesPersisted(stateDir, CALCULUS_OUTLINE)
  }

  await saveCheckpoint(name, stateDir, storageStatePath, {
    name,
    parent,
    formatVersion: 1,
    migrationHash: hashText("migrations"),
    setupHash: hashText(name === "SETUP_PLAN_TOC" ? AUTOMATA_OUTLINE : name === "SETUP_PLAN_CALCULUS" ? CALCULUS_OUTLINE : name),
    createdAt: new Date().toISOString(),
    sourceCommit: "local",
  })
  await rm(runRoot, { recursive: true, force: true })
}

export async function ensureCheckpoints(reset: boolean) {
  if (reset) {
    const { resetCheckpoints } = await import("./checkpoints")
    await resetCheckpoints()
  }
  const names = Object.keys(CHECKPOINT_GRAPH) as CheckpointName[]
  for (const name of names) {
    if (await checkpointExists(name)) continue
    const parent = CHECKPOINT_GRAPH[name] as CheckpointName | null
    if (parent && !(await checkpointExists(parent))) await ensureCheckpoints(false)
    await buildCheckpoint(name, parent)
  }
}

export async function closeBrowser(browser: Browser) {
  await browser.close()
}
