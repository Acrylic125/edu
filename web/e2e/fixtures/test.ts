import { test as base, expect, type Page } from "@playwright/test"
import { cp, rm } from "node:fs/promises"
import { checkpointBrowserStatePath, type CheckpointName, ensureRunRoot } from "../helpers/checkpoints"
import { startServices, stopServices } from "../helpers/services"
import { validateMessageParts } from "../helpers/validators"
import { WsServerMessageSchema } from "@/lib/chat/ws-schema"
import { MessagePartsSchema, type MessagePart } from "@edu/chat-contract"

type Observer = {
  assertClean: () => Promise<void>
  texts: () => string[]
}

function createObserver(page: Page): Observer {
  const failures: Error[] = []
  const responses: string[] = []
  const pending: Promise<void>[] = []
  const secrets = [process.env.OPENROUTER_API_KEY, process.env.BETTER_AUTH_SECRET].filter(
    (value): value is string => Boolean(value),
  )

  function inspectParts(parts: MessagePart[]) {
    for (const part of parts) {
      responses.push(JSON.stringify(part))
    }
    const validation = validateMessageParts(parts, secrets).catch((error: Error) => {
      failures.push(error)
    })
    pending.push(validation)
  }

  page.on("websocket", (socket) => {
    socket.on("framereceived", (raw) => {
      if (typeof raw !== "string") return
      try {
        const parsed = WsServerMessageSchema.safeParse(JSON.parse(raw))
        if (!parsed.success || parsed.data.type !== "run.ended") return
        inspectParts(parsed.data.parts)
      } catch {
        return
      }
    })
  })

  page.on("response", (response) => {
    if (!response.url().endsWith("/topics/current/messages")) return
    const work = response
      .json()
      .then((payload) => {
        const messages = payload.messages
        if (!Array.isArray(messages)) return
        for (const message of messages) {
          if (message.role === "assistant" && Array.isArray(message.parts)) inspectParts(MessagePartsSchema.parse(message.parts))
        }
      })
      .catch((error: Error) => {
        failures.push(error)
      })
    pending.push(work)
  })

  return {
    async assertClean() {
      await Promise.all(pending)
      if (failures.length > 0) throw new Error(failures.map((failure) => failure.message).join("\n"))
    },
    texts() {
      return [...responses]
    },
  }
}

type Fixtures = {
  checkpoint: CheckpointName
  observer: Observer
  page: Page
}

export const test = base.extend<Fixtures>({
  checkpoint: ["SETUP_PLAN_TOC", { option: true }],
  page: async ({ browser, checkpoint }, use, testInfo) => {
    const runRoot = await ensureRunRoot(`${testInfo.workerIndex}-${testInfo.testId}`)
    const stateDir = `${runRoot}/state`
    await rm(stateDir, { recursive: true, force: true })
    await cp(`${process.cwd()}/.e2e/checkpoints/${checkpoint}/state`, stateDir, { recursive: true })
    const services = await startServices(stateDir, testInfo.outputDir)
    const context = await browser.newContext({
      baseURL: "http://localhost:3100",
      storageState: checkpointBrowserStatePath(checkpoint),
    })
    const page = await context.newPage()
    const observer = createObserver(page)
    await page.goto("/chat")
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(5_000)
    await expect(page.locator("form").filter({ has: page.getByRole("button", { name: "Send" }) })).toHaveCount(1)
    await use(page)
    await observer.assertClean()
    await context.close()
    await stopServices(services)
  },
  observer: async ({ page }, use) => {
    await use(createObserver(page))
  },
})

export { expect }
