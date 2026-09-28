"use client"

import dynamic from "next/dynamic"

const BlockNoteViewerClient = dynamic(
  () => import("@/components/chat/blocknote-viewer-client"),
  { ssr: false, loading: () => <div className="h-6 animate-pulse rounded bg-muted/50" /> },
)

export function BlockNoteViewer({ text, showBlockHandles = false }: { text: string; showBlockHandles?: boolean }) {
  return <BlockNoteViewerClient text={text} showBlockHandles={showBlockHandles} />
}
