import { randomUUID } from "node:crypto"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { indexDocument, materialDigest } from "../src/main/material-extraction"

export function pdfFixture(count: number) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
  for (let page = 1; page <= count; page++) {
    const content = `${(page - 1) / count} 0.8 0.5 rg 0 0 240 160 re f 0 0 0 rg BT /F1 18 Tf 30 100 Td (Source page ${page}) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (page - 1) * 2} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  }
  let source = "%PDF-1.4\n"
  const offsets = [0]
  for (const [offset, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${offset + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(source)
}

export async function createVisionFixture(count: number, response = "valid") {
  const directory = await mkdtemp(join(tmpdir(), "edu-vision-"))
  const bytes = pdfFixture(count)
  const pages = Array.from({ length: count }, (_, i) => `Source page ${i + 1}`)
  const material = { id: randomUUID(), name: "pages.pdf", kind: "pdf" as const, text: pages.join("\n"), pages, documentIndex: indexDocument(materialDigest(bytes, ".pdf"), pages, "pages.pdf") }
  const executable = join(directory, "codex.mjs")
  const log = join(directory, "calls.jsonl")
  await writeFile(join(directory, material.name), bytes)
  await writeFile(executable, `#!${process.execPath}
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
let sequence = 0;
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({id:message.id,result:{}});
  if (message.method === "thread/start") send({id:message.id,result:{thread:{id:"t" + ++sequence}}});
  if (message.method !== "turn/start") return;
  const input = message.params.input;
  const pages = input.filter(item => item.type === "text" && /^Source page /.test(item.text)).map(item => Number(item.text.match(/\\d+/)[0]));
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ pages, images: input.filter(item => item.type === "image").map(item => ({type:item.type, detail:item.detail, png:item.url.startsWith("data:image/png;base64,iVBOR"), url:item.url})) }) + "\\n");
  const response = ${JSON.stringify(response)};
  let results = pages.map(page => ({page, headings:[{text:"Heading " + page,level:1}]}));
  if (response === "missing") results.pop();
  if (response === "duplicate") results = [{page:pages[0],headings:[]},{page:pages[0],headings:[]}];
  if (response === "unrequested") results[0].page = 999;
  if (response === "invalid-heading") results[0].headings[0].level = 0;
  send({id:message.id,result:{}});
  send({method:"thread/tokenUsage/updated",params:{threadId:message.params.threadId,tokenUsage:{last:{inputTokens:100,outputTokens:20}}}});
  send({method:"item/completed",params:{threadId:message.params.threadId,item:{type:"agentMessage",phase:"final_answer",text:response === "malformed" ? "not JSON" : JSON.stringify({pages:results})}}});
  send({method:"turn/completed",params:{threadId:message.params.threadId,turn:{status:response === "failed" ? "failed" : "completed",error:response === "failed" ? {message:"Model rejected images"} : null}}});
});
`, { mode: 0o700 })
  return { directory, material, executable, log, connection: { executable, home: directory }, cache: join(directory, "cache") }
}


export async function presentationFixture() {
  const { zipSync, strToU8 } = await import("fflate")
  const files = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    "ppt/presentation.xml": '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>',
    "ppt/_rels/presentation.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    "ppt/slides/slide1.xml": '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="127000" y="254000"/><a:ext cx="5080000" cy="508000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/><a:t>Native slide title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  }
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)]))))
}

export function softMaskPdfFixture() {
  const drawing = "q /Mask gs 1 0 0 rg 0 0 200 100 re f Q"
  const mask = "1 1 1 rg 0 0 100 100 re f 0 0 0 rg 100 0 100 100 re f"
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /ExtGState << /Mask 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /ExtGState /SMask << /S /Luminosity /G 6 0 R >> >>",
    `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
    `<< /Type /XObject /Subtype /Form /BBox [0 0 200 100] /Group << /S /Transparency /CS /DeviceRGB >> /Resources << >> /Length ${mask.length} >>\nstream\n${mask}\nendstream`,
  ]
  let source = "%PDF-1.4\n"
  const offsets = [0]
  for (const [offset, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${offset + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(source)
}
