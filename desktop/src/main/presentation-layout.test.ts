import assert from "node:assert/strict"
import { test } from "node:test"
import { zipSync, strToU8 } from "fflate"
import { presentationLayout } from "./presentation-layout"

test("PPTX geometry follows manifest order, retains blank slides and transforms grouped shapes", () => {
  // Slide filenames are reversed deliberately; nested geometry must use group scales, not XML order.
  const archive = zipSync({
    "ppt/presentation.xml": strToU8('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>'),
    "ppt/_rels/presentation.xml.rels": strToU8('<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>'),
    "ppt/slides/slide1.xml": strToU8('<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld></p:sld>'),
    "ppt/slides/slide2.xml": strToU8('<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:grpSp><p:grpSpPr><a:xfrm><a:off x="127000" y="254000"/><a:ext cx="2540000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="1270000"/></a:xfrm></p:grpSpPr><p:sp><p:spPr><a:xfrm><a:off x="127000" y="127000"/><a:ext cx="254000" cy="127000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Group title</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp></p:spTree></p:cSld></p:sld>'),
  })
  const pages = presentationLayout(Buffer.from(archive))
  assert.equal(pages.length, 2)
  assert.deepEqual([pages[0].width, pages[0].height], [720, 405])
  assert.deepEqual(pages[0].blocks, [{ type: "shape", text: "Group title", depth: 1, bounds: { x: 30, y: 30, width: 40, height: 10 } }])
  assert.deepEqual(pages[1].blocks, [])
})

test("PPTX missing slide parts are rejected rather than silently dropping slides", () => {
  // A manifest entry with no ZIP part must fail instead of shortening the source's page list.
  const archive = zipSync({
    "ppt/presentation.xml": strToU8('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>'),
    "ppt/_rels/presentation.xml.rels": strToU8('<Relationships><Relationship Id="r1" Target="slides/missing.xml"/></Relationships>'),
  })
  assert.throws(() => presentationLayout(Buffer.from(archive)), /missing a slide part/)
})
