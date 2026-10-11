import { randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { dialog } from "electron"
import { extractText, getDocumentProxy } from "unpdf"
import { z } from "zod"
import { MaterialSchema } from "../shared/contracts"
import { WorkspaceRepository } from "./workspace"

export async function importMaterials(
  repository: WorkspaceRepository,
  topicId: string,
) {
  repository.topic(topicId)
  const selection = await dialog.showOpenDialog({
    title: "Add learning materials",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Learning materials",
        extensions: [
          "pdf",
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
  })
  if (selection.canceled) return
  if (selection.filePaths.length > 12)
    throw new Error("Add up to 12 materials at a time.")
  const materials: z.infer<typeof MaterialSchema>[] = []
  const assetDirectory = join(repository.directory, "topics", topicId, "assets")
  await mkdir(assetDirectory, { recursive: true })
  for (const source of selection.filePaths) {
    const info = await stat(source)
    if (info.size > 20 * 1024 * 1024)
      throw new Error(
        `${basename(source)} is larger than 20 MB. Add a smaller file.`,
      )
    const buffer = await readFile(source)
    let text = ""
    let pages: string[] = []
    let kind: z.infer<typeof MaterialSchema>["kind"] = "text"
    if (extname(source).toLowerCase() === ".pdf") {
      kind = "pdf"
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      try {
        const extracted = await extractText(pdf, { mergePages: false })
        pages = extracted.text
        text = pages.join("\n\n")
      } finally {
        await pdf.loadingTask.destroy()
      }
    } else if (
      [".png", ".jpg", ".jpeg", ".webp"].includes(extname(source).toLowerCase())
    ) {
      kind = "image"
      if (info.size > 8 * 1024 * 1024)
        throw new Error("Use images smaller than 8 MB.")
      text = "Image source. Use read_material to inspect the image visually."
    } else {
      if (buffer.includes(0))
        throw new Error(`${basename(source)} is not a readable text file.`)
      text = buffer.toString("utf8")
    }
    const name = basename(source)
    const topic = repository.topic(topicId)
    if (
      topic.materials.some((item) => item.name === name) ||
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
    })
    materials.push(material)
    await copyFile(source, join(assetDirectory, name))
  }
  await repository.mutate((workspace) => {
    const topic = workspace.topics.find((item) => item.id === topicId)
    if (!topic) throw new Error("Topic not found.")
    if (
      topic.materials.reduce(
        (size, material) => size + material.text.length,
        0,
      ) +
        materials.reduce((size, material) => size + material.text.length, 0) >
      1_000_000
    )
      throw new Error(
        "This topic has too much source text. Split the materials into smaller topics.",
      )
    topic.materials.push(...materials)
  })
}
