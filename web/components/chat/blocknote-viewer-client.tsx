"use client"

import { useEffect, useRef, useState } from "react"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/mantine"

import { useThemeMode } from "@/components/theme/theme-provider"

import "@blocknote/core/fonts/inter.css"
import "@blocknote/mantine/style.css"

type BlockPosition = {
  id: string
  top: number
  height: number
  handleLeft: number
  handleTop: number
  lineCenter: number
  headingLevel: number | null
}
type PaneWidth = { left: number; width: number }

function firstTextLineRect(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const content = node.textContent ?? ""
    const firstCharacter = content.search(/\S/)
    if (firstCharacter >= 0) {
      const range = document.createRange()
      range.setStart(node, firstCharacter)
      range.setEnd(node, firstCharacter + 1)
      const rect = range.getBoundingClientRect()
      if (rect.height > 0) return rect
    }
    node = walker.nextNode()
  }
  return element.getBoundingClientRect()
}

export default function BlockNoteViewerClient({ text, showBlockHandles }: { text: string; showBlockHandles: boolean }) {
  const editor = useCreateBlockNote()
  const { dark } = useThemeMode()
  const rootRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<BlockPosition[]>([])
  const [paneWidth, setPaneWidth] = useState<PaneWidth | null>(null)
  const [titleLineCenter, setTitleLineCenter] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const blocks = editor.tryParseMarkdownToBlocks(text)
    editor.replaceBlocks(editor.document, blocks.length > 0 ? blocks : [{ type: "paragraph", content: "" }])
  }, [editor, text])

  useEffect(() => {
    if (!showBlockHandles) return
    const root = rootRef.current
    if (!root) return
    const view = root.querySelector(".bn-container")
    const pane = root.closest<HTMLElement>("[data-document-pane]")
    if (!view || !pane) return
    const measuredPane = pane
    const title = pane.querySelector<HTMLElement>("[data-document-title]")
    let frame = 0
    function measure() {
      if (!root) return
      const rootRect = root.getBoundingClientRect()
      const paneRect = measuredPane.getBoundingClientRect()
      const nextPaneWidth = {
        left: paneRect.left - rootRect.left,
        width: paneRect.width,
      }
      setPaneWidth((current) => {
        if (current && Math.abs(current.left - nextPaneWidth.left) < 1 && Math.abs(current.width - nextPaneWidth.width) < 1) return current
        return nextPaneWidth
      })
      if (title) {
        const titleRect = firstTextLineRect(title)
        const center = titleRect.top - rootRect.top + titleRect.height / 2
        setTitleLineCenter((current) => current !== null && Math.abs(current - center) < 1 ? current : center)
      }
      const next = [...root.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]")].map((block) => {
        const content = block.querySelector<HTMLElement>(".bn-block-content")
        const rect = (content ?? block).getBoundingClientRect()
        const line = firstTextLineRect(content ?? block)
        const lineCenter = line.top - rootRect.top + line.height / 2
        const heading = content?.matches('[data-content-type="heading"]') ? content : content?.querySelector<HTMLElement>('[data-content-type="heading"]')
        return {
          id: block.dataset.id ?? "",
          top: rect.top - rootRect.top,
          height: rect.height,
          handleLeft: rect.left - rootRect.left - 36,
          handleTop: lineCenter - 14,
          lineCenter,
          headingLevel: heading ? Number(heading.dataset.level ?? "2") : null,
        }
      }).filter((block) => block.id !== "")
      setPositions((current) => {
        if (current.length === next.length && current.every((position, index) => position.id === next[index]?.id && Math.abs(position.top - (next[index]?.top ?? 0)) < 1 && Math.abs(position.height - (next[index]?.height ?? 0)) < 1 && Math.abs(position.handleLeft - (next[index]?.handleLeft ?? 0)) < 1 && Math.abs(position.handleTop - (next[index]?.handleTop ?? 0)) < 1 && position.headingLevel === next[index]?.headingLevel)) return current
        return next
      })
    }
    function scheduleMeasure() {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measure)
    }
    const mutation = new MutationObserver(scheduleMeasure)
    mutation.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-id"] })
    const resize = new ResizeObserver(scheduleMeasure)
    resize.observe(view)
    resize.observe(measuredPane)
    if (title) resize.observe(title)
    scheduleMeasure()
    return () => {
      mutation.disconnect()
      resize.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [editor, showBlockHandles, text])

  const active = positions.find((position) => position.id === (hoveredId ?? selectedId))
  let treeNodes: Array<{ x: number; y: number }> = []
  if (active && titleLineCenter !== null && positions[0]) {
    const headings: BlockPosition[] = []
    for (const position of positions) {
      if (position.headingLevel !== null) {
        while (headings.length > 0) {
          const previous = headings[headings.length - 1]
          if (previous.headingLevel !== null && previous.headingLevel < position.headingLevel) break
          headings.pop()
        }
      }
      if (position.id === active.id) break
      if (position.headingLevel !== null) headings.push(position)
    }
    const pathBlocks = [...headings, active]
    const targetX = active.handleLeft + 14
    const rootX = Math.max((paneWidth?.left ?? 0) + 20, targetX - 32 * pathBlocks.length)
    const step = (targetX - rootX) / pathBlocks.length
    treeNodes = [
      { x: rootX, y: titleLineCenter },
      ...pathBlocks.map((position, index) => ({
        x: index === pathBlocks.length - 1 ? targetX : rootX + step * (index + 1),
        y: position.lineCenter,
      })),
    ]
  }
  const treePath = treeNodes.map((node, index) => {
    if (index === 0) return `M ${node.x} ${node.y}`
    return `V ${node.y} H ${node.x}`
  }).join(" ")

  return (
    <div
      ref={rootRef}
      className="document-blocknote relative min-w-0"
      data-block-handles={showBlockHandles}
      onMouseMove={(event) => {
        if (!showBlockHandles) return
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const handle = target.closest<HTMLElement>("[data-block-handle]")
        if (handle) {
          setHoveredId(handle.dataset.blockHandle ?? null)
          return
        }
        const hit = target.closest<HTMLElement>("[data-block-hit]")
        if (hit) {
          setHoveredId(hit.dataset.blockHit ?? null)
          return
        }
        setHoveredId(target.closest<HTMLElement>(".bn-block-outer[data-id]")?.dataset.id ?? null)
      }}
      onMouseLeave={() => setHoveredId(null)}
    >
      <BlockNoteView editor={editor} editable={false} theme={dark ? "dark" : "light"} sideMenu={false} formattingToolbar={false} slashMenu={false} />
      {showBlockHandles && paneWidth ? <>
        {positions.map((position) => {
          let highlightClass = "absolute z-0"
          if (hoveredId === position.id) {
            highlightClass = "absolute z-0 bg-card/50"
          }
          if (selectedId === position.id) {
            highlightClass = "absolute z-0 bg-sky-400/10 ring-1 ring-inset ring-sky-400"
          }
          return <div
            key={`hit-${position.id}`}
            aria-hidden="true"
            data-block-hit={position.id}
            className={highlightClass}
            style={{ left: paneWidth.left, width: paneWidth.width, top: position.top, height: Math.max(position.height, 28) }}
            onMouseEnter={() => setHoveredId(position.id)}
          />
        })}
        {treeNodes.length > 1 ? <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible text-border" width="1" height="1">
          <path d={treePath} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          {treeNodes.slice(0, -1).map((node, index) => <circle key={index} cx={node.x} cy={node.y} r="6.5" fill="var(--background)" stroke="currentColor" strokeWidth="1.75" />)}
        </svg> : null}
        {positions.map((position, index) => <button
          key={position.id}
          type="button"
          aria-label={`Select document block ${index + 1}`}
          aria-pressed={selectedId === position.id}
          data-block-handle={position.id}
          className={hoveredId === position.id || selectedId === position.id ? "absolute z-20 flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" : "absolute z-20 flex size-7 items-center justify-center rounded-full opacity-0 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"}
          style={{ top: position.handleTop, left: position.handleLeft }}
          onMouseEnter={() => setHoveredId(position.id)}
          onClick={() => setSelectedId(selectedId === position.id ? null : position.id)}
        ><span className={selectedId === position.id ? "size-3.5 rounded-full bg-border" : "size-3.5 rounded-full border-2 border-border bg-background"} aria-hidden="true" /></button>)}
      </> : null}
    </div>
  )
}
