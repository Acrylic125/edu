import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { z } from "zod"

const bump = z.enum(["auto", "patch", "minor", "major"]).parse(process.argv[2] ?? "auto")
const input = z.object({
  RELEASE_PR_BASE_SHA: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  RELEASE_PR_TITLE: z.string().min(1).optional(),
  RELEASE_PR_BODY: z.string().optional(),
}).refine((value) => !value.RELEASE_PR_BASE_SHA || value.RELEASE_PR_TITLE, {
  message: "PR version checks require the PR title.",
}).parse(process.env)
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/)
const manifest = z.object({ version: versionSchema }).parse(JSON.parse(readFileSync("desktop/package.json", "utf8")))
const historyHead = input.RELEASE_PR_BASE_SHA ?? "HEAD"
const tags = git("tag", "--merged", historyHead).split("\n")
  .filter((tag) => /^v?\d+\.\d+\.\d+$/.test(tag))
  .map((tag) => ({ tag, parts: tag.replace(/^v/, "").split(".").map(Number) }))
  .sort((left, right) => right.parts[0] - left.parts[0] || right.parts[1] - left.parts[1] || right.parts[2] - left.parts[2])
const base = tags[0]
let commits = git("log", ...(base ? [`${base.tag}..${historyHead}`] : [historyHead]), "--format=%B%x00")
if (input.RELEASE_PR_BASE_SHA) {
  // Squash merges use the PR message, so intermediate branch commits must not select the bump.
  commits += `\0${input.RELEASE_PR_TITLE}\n\n${input.RELEASE_PR_BODY ?? ""}`
}
let selected = bump
if (bump === "auto") {
  selected = "none"
  for (const message of commits.split("\0")) {
    if (/^\w+(?:\([^\r\n]+\))?!: /m.test(message) || /^BREAKING[ -]CHANGE: /m.test(message)) {
      selected = "major"
      break
    }
    if (/^feat(?:\([^\r\n]+\))?: /m.test(message)) {
      selected = "minor"
    } else if (selected === "none" && /^fix(?:\([^\r\n]+\))?: /m.test(message)) {
      selected = "patch"
    }
  }
  if (selected === "none") {
    throw new Error("No Conventional Commit release changes found. Select patch, minor, or major explicitly.")
  }
}
let [major, minor, patch] = base?.parts ?? manifest.version.split(".").map(Number)
if (selected === "major") {
  major += 1
  minor = 0
  patch = 0
} else if (selected === "minor") {
  minor += 1
  patch = 0
} else {
  patch += 1
}
const version = `${major}.${minor}.${patch}`
const tag = `v${version}`
// A tag on another branch must not be overwritten by a release from this branch.
if (git("tag", "--list", tag, version)) {
  throw new Error(`Version ${version} already has a tag.`)
}
const output = `version=${version}\ntag=${tag}\nbase_tag=${base?.tag ?? ""}\nsha=${git("rev-parse", "HEAD")}\n`
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
process.stdout.write(output)
