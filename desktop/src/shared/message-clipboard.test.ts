import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { clipboardMaterialIds, messageClipboardHtml, messageCopyText } from "./message-clipboard"
import { MessageSchema } from "./contracts"

test("clipboard attachment references survive rich text serialization", () => {
  const ids = [randomUUID(), randomUUID()]
  const html = messageClipboardHtml("Use <slides> & notes\nfor practice", ids)
  assert.deepEqual(clipboardMaterialIds(html), ids)
  assert.deepEqual(clipboardMaterialIds(messageClipboardHtml(`<div data-edu-materials="${ids.join(",")}">`, [])), [])
  assert.ok(html.includes("Use &lt;slides&gt; &amp; notes\nfor practice"))
})

test("ordinary and malformed clipboard HTML supplies no attachments", () => {
  for (const html of ["", "<p>Lecture.pdf</p>", '<div data-edu-materials="../../private">', '<div data-edu-materials="123">']) {
    assert.deepEqual(clipboardMaterialIds(html), [])
  }
})

test("copy omits generated filename lists while preserving attachment references and authored text", () => {
  const materialIds = [randomUUID(), randomUUID()]
  for (const action of ["work with", "understand"]) {
    const message = MessageSchema.parse({
      id: randomUUID(), role: "user", createdAt: new Date().toISOString(), materialIds,
      content: `Help me ${action} the attached materials: Lecture 6.pdf, Lecture 6.pptx.`,
    })
    const text = messageCopyText(message, message.content)
    assert.equal(text, `Help me ${action} the attached materials.`)
    assert.deepEqual(clipboardMaterialIds(messageClipboardHtml(text, materialIds)), materialIds)
    assert.equal(messageCopyText({ ...message, role: "assistant" }, message.content), message.content)
    assert.equal(messageCopyText({ ...message, materialIds: [] }, message.content), message.content)
    const authored = "Compare Lecture 6.pdf with Lecture 6.pptx."
    assert.equal(messageCopyText(message, authored), authored)
  }
})
