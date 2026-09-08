import { test, expect } from "../fixtures/test"
import { judgeChat } from "../helpers/judge"

async function send(page: import("@playwright/test").Page, text: string) {
  const composer = page.locator("form:has(button[aria-label='Send']) textarea")
  await composer.fill(text)
  await expect(page.getByRole("button", { name: "Send" })).not.toHaveAttribute("aria-disabled", "true", { timeout: 60_000 })
  await page.getByRole("button", { name: "Send" }).click()
}

async function waitForAssistant(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-message-role='assistant']").last()).toBeVisible({ timeout: 180_000 })
}

test.describe("checkpointed real-model chat flow", () => {
  test("updates the plan through an explicit command and a confirmed proposal", async ({ page }) => {
    await send(page, "/update Include P vs NP")
    await expect(page.getByText("Learning plan updated!", { exact: false })).toBeVisible({ timeout: 180_000 })

    await send(page, "Include NP Complete Reduction examples into the plan, e.g. 3-SAT, and Vertex Cover")
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible({ timeout: 180_000 })
    await page.getByRole("button", { name: "Accept" }).click()
    await expect(page.getByText("Learning plan updated!", { exact: false }).last()).toBeVisible({ timeout: 180_000 })

    await page.getByRole("button", { name: "See Plan" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("P vs NP", { exact: false })).toBeVisible()
    await expect(dialog.getByText("3-SAT", { exact: false })).toBeVisible()
    await expect(dialog.getByText("Vertex Cover", { exact: false })).toBeVisible()
  })

  test("selects a plan step and answers the current-topic question", async ({ page }) => {
    await page.getByRole("button", { name: "See Plan" }).click()
    const plan = page.getByRole("dialog")
    const candidate = plan.getByText("Deterministic Finite Automata", { exact: false }).first()
    await candidate.click()
    await expect(plan).toBeHidden()

    await send(page, "What is the current topic?")
    await waitForAssistant(page)
    await judgeChat({
      criterion: "The answer identifies deterministic finite automata as the selected current topic and does not claim that calculus is selected.",
      conversation: "The learner selected a nested plan step in Automata and Regular Languages.",
      response: await page.locator("[data-message-role='assistant']").last().innerText(),
    })
  })

  test("edits the saved plan from See Plan", async ({ page }) => {
    await page.getByRole("button", { name: "See Plan" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "Edit plan" }).click()
    const outline = dialog.getByRole("textbox", { name: "Plan outline" })
    await outline.fill((await outline.inputValue()).replace("Deterministic Finite Automata (DFAs)", "DFA foundations"))
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expect(dialog.getByText("DFA foundations", { exact: true })).toBeVisible()

    await page.reload()
    await page.getByRole("button", { name: "See Plan" }).click()
    await expect(page.getByRole("dialog").getByText("DFA foundations", { exact: true })).toBeVisible()
  })

  test("rejects an inappropriate plan update", async ({ page }) => {
    await send(page, "/update Include Derivatives to the topic")
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible({ timeout: 180_000 })
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible()
    await page.getByRole("button", { name: "Reject" }).click()
    await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0)
    await page.getByRole("button", { name: "See Plan" }).click()
    await expect(page.getByRole("dialog").getByText("Derivatives", { exact: false })).toHaveCount(0)
  })

  test("explains the first topic and provides practice actions", async ({ page }) => {
    await page.getByRole("button", { name: /Explain/ }).first().click()
    await waitForAssistant(page)
    await expect(page.getByRole("button", { name: /Practice/ })).toBeVisible({ timeout: 180_000 })
    await expect(page.getByRole("button", { name: "Continue to next topic" })).toBeVisible()
    await judgeChat({
      criterion: "The answer accurately explains deterministic finite automata at an introductory level.",
      conversation: "The selected first topic is Deterministic Finite Automata (DFAs).",
      response: await page.locator("[data-message-role='assistant']").last().innerText(),
    })
  })

  test.describe("after the first-topic checkpoint", () => {
    test.use({ checkpoint: "SUBTOPIC_1" })

    test("continues to the next topic", async ({ page }) => {
      await page.getByRole("button", { name: "Continue to next topic" }).click()
      await waitForAssistant(page)
      await expect(page.getByRole("button", { name: "Continue to next topic" })).toBeVisible({ timeout: 180_000 })
    })

    test("generates six distinct practice questions", async ({ page }) => {
      await page.getByRole("button", { name: /Practice/ }).click()
      const questions: string[] = []
      for (let index = 0; index < 3; index += 1) {
        await waitForAssistant(page)
        questions.push(await page.locator("[data-message-role='assistant']").last().innerText())
        if (index < 2) await page.getByRole("button", { name: "Next Question" }).click()
      }
      await send(page, "Elaborate")
      await waitForAssistant(page)
      await page.getByRole("button", { name: "Next Question" }).click()
      for (let index = 0; index < 3; index += 1) {
        await waitForAssistant(page)
        questions.push(await page.locator("[data-message-role='assistant']").last().innerText())
        if (index < 2) await page.getByRole("button", { name: "Next Question" }).click()
      }
      const normalized = questions.map((question) => question.toLowerCase().replace(/\s+/g, " ").trim())
      expect(new Set(normalized).size).toBe(6)
      await judgeChat({
        criterion: "All six questions are about the selected automata subtopic and are semantically distinct, not merely cosmetic rewrites.",
        conversation: "The learner requested practice, three questions, an elaboration, and three more questions.",
        response: questions.join("\n\n--- QUESTION ---\n\n"),
      })
    })
  })

  test.describe("calculus topic checkpoint", () => {
    test.use({ checkpoint: "SETUP_PLAN_CALCULUS" })

    test("summarizes the selected calculus plan", async ({ page }) => {
      await send(page, "What is this topic?")
      await waitForAssistant(page)
      await judgeChat({
        criterion: "The response summarizes the calculus plan and covers limits and continuity, differential calculus, integral calculus, sequences and series, and multivariable/vector calculus.",
        conversation: "The selected plan is the supplied Calculus I, II, and III outline.",
        response: await page.locator("[data-message-role='assistant']").last().innerText(),
      })
    })
  })
})
