import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, extname, join } from "node:path"
import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron"
import { z } from "zod"
import { MaterialOwnerSchema, MaterialSchema, PastedImageSchema } from "../shared/contracts"
import { WorkspaceRepository } from "./workspace"
import { extractMaterial } from "./material-extraction"

async function selectMaterialFiles(parent?: BrowserWindow) {
  const options = {
    title: "Add learning materials",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Learning materials",
        extensions: [
          "pdf",
          "pptx",
          "png",
          "jpg",
          "jpeg",
          "webp",
          "md",
          "txt",
          "csv",
          "ts",
          "tsx",
          "js",
          "py",
          "json",
        ],
      },
    ],
  } satisfies OpenDialogOptions
  let selection
  if (parent) selection = await dialog.showOpenDialog(parent, options)
  else selection = await dialog.showOpenDialog(options)
  if (selection.canceled) return []
  if (selection.filePaths.length > 12)
    throw new Error("Add up to 12 materials at a time.")
  return selection.filePaths
}

export class MaterialDrafts {
  // Clipboard images have no native path, so keep their bytes until the draft is imported.
  private sources = new Map<string, { name: string; source: string | Uint8Array }>()

  async select(draftIds: string[], parent?: BrowserWindow) {
    return this.add(draftIds, await selectMaterialFiles(parent))
  }

  async add(draftIds: string[], sources: string[]) {
    const drafts = draftIds.map((id) => {
      const source = this.sources.get(id)
      if (!source) throw new Error("Select the learning materials again.")
      return { id, name: source.name }
    })
    if (drafts.length + sources.length > 12)
      throw new Error("Add up to 12 materials at a time.")
    const names = new Set(drafts.map((draft) => draft.name))
    for (const source of sources) {
      const name = basename(source)
      if (names.has(name))
        throw new Error(`${name} is already attached. Rename the new file to preserve both sources.`)
      names.add(name)
      const info = await stat(source)
      if (!info.isFile())
        throw new Error(`${name} is a folder. Attach individual files instead.`)
      if (info.size > 20 * 1024 * 1024)
        throw new Error(`${name} is larger than 20 MB. Add a smaller file.`)
    }
    for (const source of sources) {
      const id = randomUUID()
      this.sources.set(id, { name: basename(source), source })
      drafts.push({ id, name: basename(source) })
    }
    return drafts
  }

  discard(draftIds: string[]) {
    for (const id of draftIds) this.sources.delete(id)
  }

  async paste(draftIds: string[], images: z.infer<typeof PastedImageSchema>[]) {
    const drafts = await this.add(draftIds, [])
    const validated = PastedImageSchema.array().min(1).max(12).parse(images)
    if (drafts.length + validated.length > 12)
      throw new Error("Add up to 12 materials at a time.")
    for (const image of validated) {
      const id = randomUUID()
      let extension = "png"
      if (image.mimeType === "image/jpeg") extension = "jpg"
      if (image.mimeType === "image/webp") extension = "webp"
      const name = `pasted-image-${id}.${extension}`
      this.sources.set(id, { name, source: image.data })
      drafts.push({ id, name })
    }
    return drafts
  }

  async import(repository: WorkspaceRepository, owner: z.infer<typeof MaterialOwnerSchema>, draftIds: string[]) {
    const sources = draftIds.map((id) => {
      const source = this.sources.get(id)
      if (!source) throw new Error("Select the learning materials again.")
      return source
    })
    let temporaryDirectory: string | undefined
    try {
      const paths: string[] = []
      for (const { name, source } of sources) {
        if (typeof source === "string") {
          paths.push(source)
          continue
        }
        temporaryDirectory ??= await mkdtemp(join(tmpdir(), "edu-pasted-materials-"))
        const path = join(temporaryDirectory, name)
        await writeFile(path, source)
        paths.push(path)
      }
      await importMaterials(repository, owner, paths)
      for (const id of draftIds) this.sources.delete(id)
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

export async function importMaterials(
  repository: WorkspaceRepository,
  owner: z.infer<typeof MaterialOwnerSchema>,
  selectedSources?: string[],
  parent?: BrowserWindow,
) {
  const collection = owner.kind === "topic" ? "scratchpads" : "chats"
  const current = () =>
    owner.kind === "topic" ? repository.scratchpad(owner.id) : repository.chat(owner.id)
  current()
  const sources = selectedSources ?? await selectMaterialFiles(parent)
  if (sources.length === 0) return
  const materials: z.infer<typeof MaterialSchema>[] = []
  const assetDirectory = join(repository.directory, collection, owner.id, "assets")
  await mkdir(assetDirectory, { recursive: true })
  try {
    for (const source of sources) {
      const info = await stat(source)
      if (info.size > 20 * 1024 * 1024)
        throw new Error(
          `${basename(source)} is larger than 20 MB. Add a smaller file.`,
        )
      const buffer = await readFile(source)
      const { text, pages, kind, documentIndex } = await extractMaterial(buffer, extname(source).toLowerCase(), join(repository.directory, "source-cache"))
      const name = basename(source)
      if (
        current().materials.some((item) => item.name === name) ||
        materials.some((item) => item.name === name)
      )
        throw new Error(
          `${name} is already attached. Rename the new file to preserve both sources.`,
        )
      const material = MaterialSchema.parse({
        id: randomUUID(),
        name,
        kind,
        text,
        pages,
        documentIndex,
      })
      await copyFile(source, join(assetDirectory, name), constants.COPYFILE_EXCL)
      materials.push(material)
    }
    await repository.mutate((workspace) => {
      const target = workspace[collection].find((item) => item.id === owner.id)
      if (!target) throw new Error("This topic or chat no longer exists.")
      if (
        target.materials.reduce(
          (size, material) => size + material.text.length,
          0,
        ) +
          materials.reduce((size, material) => size + material.text.length, 0) >
        1_000_000
      )
        throw new Error(
          "This has too much source text. Split the materials into smaller topics.",
        )
      target.materials.push(...materials)
    })
  } finally {
    // A later validation or save failure must not leave copied files without a material record.
    const committed = repository.stateSnapshot[collection].find((item) => item.id === owner.id)?.materials ?? []
    for (const material of materials) {
      if (!committed.some((item) => item.id === material.id))
        await rm(join(assetDirectory, material.name), { force: true })
    }
  }
}
