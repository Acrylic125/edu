import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ProviderModelPicker } from "../../src/renderer/provider-model-picker"
import { useWorkspace } from "../../src/renderer/store"
import { useModelPreferences } from "../../src/renderer/model-preferences"
import { ProviderStatusSchema } from "../../src/shared/contracts"

export async function testModelPicker(root: Root, host: HTMLElement) {
  const favorites = useModelPreferences.getState().favorites
  try {
    flushSync(() => {
      useModelPreferences.setState({ favorites: [] })
      useWorkspace.setState((state) => ({ snapshot: { ...state.snapshot, providers: [ProviderStatusSchema.parse({
        id: "codex", name: "Codex", connected: true,
        models: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6.1-terra"].map((id) => ({ id, name: id })),
      })] } }))
      root.render(<ProviderModelPicker value={{ provider: "codex", model: "gpt-6-luna" }} onChange={() => {}} onSetup={() => {}} />)
    })
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Choose provider and model"]')!.click())
    const deadline = performance.now() + 5000
    while (!document.querySelector('[role="option"]')) {
      if (performance.now() > deadline) throw new Error("Model picker did not open")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!document.querySelector('[role="option"][aria-label="gpt-6.1-terra"]')) throw new Error("Terra must appear in the main model list")
    if (document.querySelector('[role="option"][aria-label="gpt-6-astra"]')) throw new Error("Astra must be under More models")
    const more = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("More models"))!
    flushSync(() => more.click())
    if (!document.querySelector('[role="option"][aria-label="gpt-6-astra"]')) throw new Error("Astra must remain available under More models")
    console.log("PASS: Codex promotes Terra and keeps Astra under More models")
  } finally {
    flushSync(() => root.render(null))
    useModelPreferences.setState({ favorites })
  }
}
