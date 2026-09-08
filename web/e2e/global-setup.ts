import { ensureCheckpoints } from "./helpers/checkpoint-setup"

export default async function globalSetup() {
  await ensureCheckpoints(process.env.E2E_RESET === "1")
}
