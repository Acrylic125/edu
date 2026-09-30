"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Block } from "@blocknote/core";

import { useThemeMode } from "@/components/theme/theme-provider";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

type BlockPosition = {
  id: string;
  top: number;
  height: number;
  handleLeft: number;
  handleTop: number;
  lineCenter: number;
  headingLevel: number | null;
};
type PaneWidth = { left: number; width: number };
type BlockLocation = {
  chunkIndex: number;
  blockIndex: number;
  headingLevel: number | null;
};
type MeasuredBlock = { lineOffset: number };

function DocumentChunk({ blocks, dark }: { blocks: Block[]; dark: boolean }) {
  const editor = useCreateBlockNote({ initialContent: blocks }, [blocks]);
  return (
    <BlockNoteView
      editor={editor}
      editable={false}
      theme={dark ? "dark" : "light"}
      sideMenu={false}
      formattingToolbar={false}
      slashMenu={false}
    />
  );
}

function firstTextLineRect(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const content = node.textContent ?? "";
    const firstCharacter = content.search(/\S/);
    if (firstCharacter >= 0) {
      const range = document.createRange();
      range.setStart(node, firstCharacter);
      range.setEnd(node, firstCharacter + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) return rect;
    }
    node = walker.nextNode();
  }
  return element.getBoundingClientRect();
}

export default function BlockNoteViewerClient({
  text,
  showBlockHandles,
}: {
  text: string;
  showBlockHandles: boolean;
}) {
  const parser = useCreateBlockNote();
  const { dark } = useThemeMode();
  const rootRef = useRef<HTMLDivElement>(null);
  const measuredBlocks = useRef(new Map<string, MeasuredBlock>());
  const measuredChunks = useRef(new Map<number, number>());
  const [positions, setPositions] = useState<BlockPosition[]>([]);
  const [paneWidth, setPaneWidth] = useState<PaneWidth | null>(null);
  const [titleLineCenter, setTitleLineCenter] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const blocks = useMemo(() => {
    const parsed = parser.tryParseMarkdownToBlocks(text);
    return parsed.length > 0 ? parsed : parser.document;
  }, [parser, text]);
  const chunks = useMemo(() => {
    const result: Block[][] = [];
    let chunk: Block[] = [];
    let previousNumbered = false;
    let nextNumber = 1;
    for (const block of blocks) {
      if (chunk.length === 16) {
        result.push(chunk);
        chunk = [];
      }
      let current = block;
      if (block.type === "numberedListItem") {
        if (block.props.start !== undefined) {
          nextNumber = block.props.start;
        } else if (previousNumbered) {
          nextNumber += 1;
        } else {
          nextNumber = 1;
        }
        if (
          chunk.length === 0 &&
          previousNumbered &&
          block.props.start === undefined
        ) {
          current = { ...block, props: { ...block.props, start: nextNumber } };
        }
      }
      chunk.push(current);
      previousNumbered = block.type === "numberedListItem";
    }
    if (chunk.length > 0) result.push(chunk);
    return result;
  }, [blocks]);
  const blockLocations = useMemo(() => {
    const locations = new Map<string, BlockLocation>();
    chunks.forEach((chunk, chunkIndex) => {
      chunk.forEach((block, blockIndex) => {
        const pending = [block];
        while (pending.length > 0) {
          const current = pending.pop();
          if (!current) continue;
          const headingLevel =
            current.type === "heading" ? current.props.level : null;
          locations.set(current.id, { chunkIndex, blockIndex, headingLevel });
          pending.push(...current.children.toReversed());
        }
      });
    });
    return locations;
  }, [chunks]);
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => (chunks[index]?.length ?? 1) * 52,
    overscan: 2,
    scrollMargin,
  });

  useEffect(() => {
    setScrollElement(
      rootRef.current?.closest<HTMLElement>("[data-document-scroll]") ?? null,
    );
  }, []);

  useEffect(() => {
    if (!scrollElement) return;
    const clearHover = () => setHoveredId(null);
    scrollElement.addEventListener("scroll", clearHover, { passive: true });
    return () => scrollElement.removeEventListener("scroll", clearHover);
  }, [scrollElement]);

  useEffect(() => {
    if (!showBlockHandles) return;
    const root = rootRef.current;
    if (!root) return;
    const view = root.querySelector("[data-document-virtual-content]");
    const pane = root.closest<HTMLElement>("[data-document-pane]");
    if (!view || !pane) return;
    const measuredView = view;
    const measuredPane = pane;
    const title = pane.querySelector<HTMLElement>("[data-document-title]");
    let frame = 0;
    function measure() {
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const viewport = scrollElement ?? measuredPane;
      const paneRect = viewport.getBoundingClientRect();
      if (scrollElement) {
        const scrollRect = scrollElement.getBoundingClientRect();
        const margin = rootRect.top - scrollRect.top + scrollElement.scrollTop;
        setScrollMargin((current) =>
          Math.abs(current - margin) < 1 ? current : margin,
        );
      }
      const nextPaneWidth = {
        left: paneRect.left + viewport.clientLeft - rootRect.left,
        width: viewport.clientWidth,
      };
      setPaneWidth((current) => {
        if (
          current &&
          Math.abs(current.left - nextPaneWidth.left) < 1 &&
          Math.abs(current.width - nextPaneWidth.width) < 1
        )
          return current;
        return nextPaneWidth;
      });
      if (title) {
        const titleRect = firstTextLineRect(title);
        const center = titleRect.top - rootRect.top + titleRect.height / 2;
        setTitleLineCenter((current) =>
          current !== null && Math.abs(current - center) < 1 ? current : center,
        );
      }
      for (const chunk of measuredView.querySelectorAll<HTMLElement>(
        "[data-document-chunk-index]",
      )) {
        const index = Number(chunk.dataset.documentChunkIndex);
        measuredChunks.current.set(index, chunk.getBoundingClientRect().height);
      }
      const next = [
        ...root.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]"),
      ]
        .map((block) => {
          const chunk = block.closest<HTMLElement>(
            "[data-document-chunk-index]",
          );
          const content = block.querySelector<HTMLElement>(".bn-block-content");
          const rect = (content ?? block).getBoundingClientRect();
          const line = firstTextLineRect(content ?? block);
          const lineCenter = line.top - rootRect.top + line.height / 2;
          const heading = content?.matches('[data-content-type="heading"]')
            ? content
            : content?.querySelector<HTMLElement>(
                '[data-content-type="heading"]',
              );
          const id = block.dataset.id ?? "";
          if (chunk && id) {
            const chunkRect = chunk.getBoundingClientRect();
            measuredBlocks.current.set(id, {
              lineOffset: line.top - chunkRect.top + line.height / 2,
            });
          }
          return {
            id,
            top: rect.top - rootRect.top,
            height: rect.height,
            handleLeft: rect.left - rootRect.left - 36,
            handleTop: lineCenter - 14,
            lineCenter,
            headingLevel: heading ? Number(heading.dataset.level ?? "2") : null,
          };
        })
        .filter((block) => block.id !== "");
      setPositions((current) => {
        if (
          current.length === next.length &&
          current.every(
            (position, index) =>
              position.id === next[index]?.id &&
              Math.abs(position.top - (next[index]?.top ?? 0)) < 1 &&
              Math.abs(position.height - (next[index]?.height ?? 0)) < 1 &&
              Math.abs(position.handleLeft - (next[index]?.handleLeft ?? 0)) <
                1 &&
              Math.abs(position.handleTop - (next[index]?.handleTop ?? 0)) <
                1 &&
              position.headingLevel === next[index]?.headingLevel,
          )
        )
          return current;
        return next;
      });
    }
    function scheduleMeasure() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    }
    const mutation = new MutationObserver(scheduleMeasure);
    mutation.observe(view, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-id"],
    });
    const resize = new ResizeObserver(scheduleMeasure);
    resize.observe(view);
    resize.observe(measuredPane);
    if (title) resize.observe(title);
    scheduleMeasure();
    return () => {
      mutation.disconnect();
      resize.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [scrollElement, showBlockHandles, text]);

  const active = positions.find(
    (position) => position.id === (hoveredId ?? selectedId),
  );
  let treeNodes: Array<{ x: number; y: number }> = [];
  if (active && titleLineCenter !== null) {
    const headings: Array<{ id: string; level: number }> = [];
    for (const [id, location] of blockLocations) {
      if (location.headingLevel !== null) {
        while (headings.length > 0) {
          const previous = headings[headings.length - 1];
          if (previous.level < location.headingLevel) break;
          headings.pop();
        }
      }
      if (id === active.id) break;
      if (location.headingLevel !== null)
        headings.push({ id, level: location.headingLevel });
    }
    const pathBlocks = [
      ...headings.map((heading) => {
        const mounted = positions.find(
          (position) => position.id === heading.id,
        );
        if (mounted) return { y: mounted.lineCenter };
        const location = blockLocations.get(heading.id);
        let chunkStart = 0;
        for (let index = 0; index < (location?.chunkIndex ?? 0); index += 1) {
          chunkStart +=
            measuredChunks.current.get(index) ??
            (chunks[index]?.length ?? 1) * 52;
        }
        const lineOffset =
          measuredBlocks.current.get(heading.id)?.lineOffset ??
          ((location?.blockIndex ?? 0) + 0.5) * 52;
        return { y: chunkStart + lineOffset };
      }),
      { y: active.lineCenter },
    ];
    const targetX = active.handleLeft + 14;
    const rootX = Math.max(
      (paneWidth?.left ?? 0) + 20,
      targetX - 32 * pathBlocks.length,
    );
    const step = (targetX - rootX) / pathBlocks.length;
    treeNodes = [
      { x: rootX, y: titleLineCenter },
      ...pathBlocks.map((position, index) => ({
        x:
          index === pathBlocks.length - 1
            ? targetX
            : rootX + step * (index + 1),
        y: position.y,
      })),
    ];
  }
  const treePath = treeNodes
    .map((node, index) => {
      if (index === 0) return `M ${node.x} ${node.y}`;
      return `V ${node.y} H ${node.x}`;
    })
    .join(" ");

  return (
    <div
      ref={rootRef}
      className="document-blocknote relative min-w-0"
      data-block-handles={showBlockHandles}
      onMouseMove={(event) => {
        if (!showBlockHandles) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const handle = target.closest<HTMLElement>("[data-block-handle]");
        if (handle) {
          setHoveredId(handle.dataset.blockHandle ?? null);
          return;
        }
        const hit = target.closest<HTMLElement>("[data-block-hit]");
        if (hit) {
          setHoveredId(hit.dataset.blockHit ?? null);
          return;
        }
        setHoveredId(
          target.closest<HTMLElement>(".bn-block-outer[data-id]")?.dataset.id ??
            null,
        );
      }}
      onMouseLeave={() => setHoveredId(null)}
    >
      <div
        data-document-virtual-content
        className="relative z-[1] w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const chunk = chunks[item.index];
          if (!chunk) return null;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              data-document-chunk-index={item.index}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${item.start - scrollMargin}px)`,
              }}
            >
              <DocumentChunk blocks={chunk} dark={dark} />
            </div>
          );
        })}
      </div>
      {showBlockHandles && paneWidth ? (
        <>
          {positions.map((position) => {
            let highlightClass = "absolute z-0";
            if (hoveredId === position.id) {
              highlightClass = "absolute z-0 bg-card";
            }
            if (selectedId === position.id) {
              highlightClass =
                "absolute z-0 bg-primary/10 ring-1 ring-inset ring-primary";
            }
            return (
              <div
                key={`hit-${position.id}`}
                aria-hidden="true"
                data-block-hit={position.id}
                className={highlightClass}
                style={{
                  left: paneWidth.left,
                  width: paneWidth.width,
                  top: position.top,
                  height: Math.max(position.height, 28),
                }}
                onMouseEnter={() => setHoveredId(position.id)}
              />
            );
          })}
          {treeNodes.length > 1 ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible text-border"
              width="1"
              height="1"
            >
              <path
                d={treePath}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {treeNodes.slice(0, -1).map((node, index) => (
                <circle
                  key={index}
                  cx={node.x}
                  cy={node.y}
                  r="6.5"
                  fill="var(--background)"
                  stroke="currentColor"
                  strokeWidth="1.75"
                />
              ))}
            </svg>
          ) : null}
          {positions.map((position, index) => (
            <button
              key={position.id}
              type="button"
              aria-label={`Select document block ${index + 1}`}
              aria-pressed={selectedId === position.id}
              data-block-handle={position.id}
              className={
                hoveredId === position.id || selectedId === position.id
                  ? "absolute z-20 flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  : "absolute z-20 flex size-7 items-center justify-center rounded-full opacity-0 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              }
              style={{ top: position.handleTop, left: position.handleLeft }}
              onMouseEnter={() => setHoveredId(position.id)}
              onClick={() =>
                setSelectedId(selectedId === position.id ? null : position.id)
              }
            >
              <span
                className={
                  selectedId === position.id
                    ? "size-3.5 rounded-full bg-border"
                    : "size-3.5 rounded-full border-2 border-border bg-background"
                }
                aria-hidden="true"
              />
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
