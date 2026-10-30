import { posix } from "node:path"
import { unzipSync, strFromU8 } from "fflate"
import { load } from "cheerio"
import { z } from "zod"
import { DocumentBlockSchema } from "../shared/document-index"

const CoordinatesSchema = z.object({ x: z.coerce.number().finite(), y: z.coerce.number().finite(), width: z.coerce.number().positive(), height: z.coerce.number().positive() })

export function presentationLayout(buffer: Buffer) {
  const files = unzipSync(buffer, { filter: (entry) => /\.(xml|rels)$/.test(entry.name) })
  const presentation = files["ppt/presentation.xml"]
  const relationships = files["ppt/_rels/presentation.xml.rels"]
  if (!presentation || !relationships) throw new Error("The presentation has no slide manifest.")
  const $ = load(strFromU8(presentation), { xml: true })
  const rels = load(strFromU8(relationships), { xml: true })
  const size = CoordinatesSchema.pick({ width: true, height: true }).safeParse({ width: $("p\\:sldSz").attr("cx"), height: $("p\\:sldSz").attr("cy") })
  return $("p\\:sldId").toArray().map((slide) => {
    const id = $(slide).attr("r:id")
    const relationship = rels("Relationship").toArray().find((entry) => rels(entry).attr("Id") === id)
    const target = relationship && rels(relationship).attr("Target")
    if (!target) throw new Error("The presentation has an unresolved slide relationship.")
    let path = posix.normalize(posix.join("ppt", target))
    if (target.startsWith("/")) path = target.slice(1)
    const bytes = files[path]
    if (!bytes) throw new Error("The presentation is missing a slide part.")
    const xml = load(strFromU8(bytes), { xml: true })
    const blocks: z.infer<typeof DocumentBlockSchema>[] = []
    function visit(tree: ReturnType<typeof xml>, parent: { x: number; y: number; scaleX: number; scaleY: number }, depth: number) {
      for (const element of tree.children().toArray()) {
        const shape = xml(element)
        let transform = shape.children("p\\:spPr").children("a\\:xfrm")
        if (shape.is("p\\:graphicFrame")) transform = shape.children("p\\:xfrm")
        if (shape.is("p\\:grpSp")) transform = shape.children("p\\:grpSpPr").children("a\\:xfrm")
        const coordinates = CoordinatesSchema.safeParse({ x: transform.children("a\\:off").attr("x"), y: transform.children("a\\:off").attr("y"), width: transform.children("a\\:ext").attr("cx"), height: transform.children("a\\:ext").attr("cy") })
        if (shape.is("p\\:grpSp")) {
          const child = CoordinatesSchema.safeParse({ x: transform.children("a\\:chOff").attr("x"), y: transform.children("a\\:chOff").attr("y"), width: transform.children("a\\:chExt").attr("cx"), height: transform.children("a\\:chExt").attr("cy") })
          if (coordinates.success && child.success) {
            const scaleX = parent.scaleX * coordinates.data.width / child.data.width
            const scaleY = parent.scaleY * coordinates.data.height / child.data.height
            visit(shape, { x: parent.x + coordinates.data.x * parent.scaleX - child.data.x * scaleX,
              y: parent.y + coordinates.data.y * parent.scaleY - child.data.y * scaleY, scaleX, scaleY }, depth + 1)
          } else visit(shape, parent, depth + 1)
          continue
        }
        if (!shape.is("p\\:sp,p\\:pic,p\\:graphicFrame,p\\:cxnSp")) continue
        const text = shape.find("a\\:p").toArray().map((paragraph) => xml(paragraph).find("a\\:t").text()).join("\n")
        const block: z.infer<typeof DocumentBlockSchema> = { type: "shape", text, depth }
        if (coordinates.success) block.bounds = {
          x: (parent.x + coordinates.data.x * parent.scaleX) / 12700,
          y: (parent.y + coordinates.data.y * parent.scaleY) / 12700,
          width: coordinates.data.width * parent.scaleX / 12700,
          height: coordinates.data.height * parent.scaleY / 12700,
        }
        blocks.push(block)
      }
    }
    // OfficeParser retains title semantics and text runs; OOXML supplies the missing shape geometry.
    visit(xml("p\\:spTree").first(), { x: 0, y: 0, scaleX: 1, scaleY: 1 }, 0)
    const result: { width?: number; height?: number; blocks: z.infer<typeof DocumentBlockSchema>[] } = { blocks }
    if (size.success) {
      result.width = size.data.width / 12700
      result.height = size.data.height / 12700
    }
    return result
  })
}
