"use client"

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"
import { Group, Panel, usePanelRef } from "react-resizable-panels"
import {
  MenuIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PanelsTopLeftIcon,
  PanelRightIcon,
  XIcon,
} from "lucide-react"

import { Button } from "../primitives/button"
import { ScrollArea } from "../primitives/scroll-area"
import { cn } from "../utils"
import { useWorkspaceMedia } from "./use-workspace-media"
import { WorkspaceResizeHandle } from "./workspace-resize-handle"

export { TopicNavigation, TopicNavigationItem } from "./topic-navigation"

const WorkspaceLayoutContext = createContext<{
  sidebarOpen: boolean
  chatOpen: boolean
  sidebarCollapsed: boolean
  documentCollapsed: boolean
  chatCollapsed: boolean
  closeNavigation: () => void
  setSidebarOpen: (open: boolean) => void
  setChatOpen: (open: boolean) => void
  sidebarId: string
  navigationName: string
} | null>(null)

export function useWorkspaceLayout() {
  const context = useContext(WorkspaceLayoutContext)
  if (!context)
    throw new Error("Workspace layouts must be used within WorkspaceFrame")
  return context
}

export function WorkspaceFrame({
  title,
  hasChat = false,
  sidebar,
  banner,
  children,
  navigationName = "topics",
  appName = "Prune",
  nativeTitlebar = false,
  workspaceId = title,
}: {
  title: string
  hasChat?: boolean
  sidebar: ReactNode
  banner?: ReactNode
  children: ReactNode
  navigationName?: string
  appName?: string
  nativeTitlebar?: boolean
  workspaceId?: string
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [collapsedDocumentId, setCollapsedDocumentId] = useState<string | null>(null)
  const [collapsedChatId, setCollapsedChatId] = useState<string | null>(null)
  const documentCollapsed = collapsedDocumentId === workspaceId
  const chatCollapsed = collapsedChatId === workspaceId
  const sidebarId = `${navigationName}-sidebar`
  const desktopNavigation = useWorkspaceMedia("(min-width: 48rem)")
  const showSidebar = desktopNavigation && !sidebarCollapsed
  const sidebarPanel = usePanelRef()
  const sidebarWidth = useRef(240)

  // Drawer constraints set the panel to zero, so restore its preferred desktop width.
  useLayoutEffect(() => {
    if (showSidebar) sidebarPanel.current?.resize(sidebarWidth.current)
  }, [showSidebar, sidebarPanel])

  function closeNavigation() {
    setSidebarOpen(false)
    setChatOpen(false)
  }

  function updatePanels(update: () => void) {
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      update()
      return
    }
    document.startViewTransition(() => flushSync(update))
  }

  return (
    <WorkspaceLayoutContext.Provider
      value={{
        sidebarOpen,
        chatOpen,
        sidebarCollapsed,
        documentCollapsed,
        chatCollapsed,
        closeNavigation,
        setSidebarOpen,
        setChatOpen,
        sidebarId,
        navigationName,
      }}
    >
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <header
          className={cn(
            "workspace-titlebar flex h-14 shrink-0 items-center gap-3 border-b border-border/50 px-4 md:px-5",
            nativeTitlebar && "native-titlebar",
          )}
        >
          <span className="hidden shrink-0 text-sm font-semibold md:block">{appName}</span>
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Open ${navigationName}`}
              aria-expanded={sidebarOpen}
              aria-controls={sidebarId}
              className="size-9 rounded-full p-2 md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <MenuIcon className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={sidebarCollapsed ? `Expand ${navigationName}` : `Collapse ${navigationName}`}
              title={sidebarCollapsed ? `Expand ${navigationName}` : `Collapse ${navigationName}`}
              aria-expanded={!sidebarCollapsed}
              aria-controls={sidebarId}
              className="hidden size-8 rounded-lg text-muted-foreground md:inline-flex"
              onClick={() => updatePanels(() => setSidebarCollapsed(!sidebarCollapsed))}
            >
              <PanelLeftIcon className="size-4" />
            </Button>
          </div>
          <span className="hidden text-sm text-border md:block" aria-hidden="true">/</span>
          <span className="min-w-0 truncate text-sm font-medium text-muted-foreground" title={title}>{title}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {hasChat ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={documentCollapsed ? "Expand topic panel" : "Collapse topic panel"}
                  title={documentCollapsed ? "Expand topic panel" : "Collapse topic panel"}
                  aria-expanded={!documentCollapsed}
                  aria-controls="learning-document"
                  className="hidden size-8 rounded-lg text-muted-foreground lg:inline-flex"
                  onClick={() => updatePanels(() => {
                    setCollapsedDocumentId(documentCollapsed ? null : workspaceId)
                    setCollapsedChatId(null)
                  })}
                >
                  <PanelsTopLeftIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={chatCollapsed ? "Expand chat panel" : "Collapse chat panel"}
                  title={chatCollapsed ? "Expand chat panel" : "Collapse chat panel"}
                  aria-expanded={!chatCollapsed}
                  aria-controls="learning-chat"
                  className="hidden size-8 rounded-lg text-muted-foreground lg:inline-flex"
                  onClick={() => updatePanels(() => {
                    setCollapsedChatId(chatCollapsed ? null : workspaceId)
                    setCollapsedDocumentId(null)
                  })}
                >
                  <PanelRightIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open chat"
                  aria-expanded={chatOpen}
                  aria-controls="learning-chat"
                  className="size-9 rounded-full p-2 lg:hidden"
                  onClick={() => setChatOpen(true)}
                >
                  <MessageSquareIcon className="size-5" />
                </Button>
              </>
            ) : null}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 md:p-3 lg:p-4">
          <Group
            id="workspace-navigation"
            className="min-h-0 min-w-0 flex-1"
            disabled={!showSidebar}
            style={{ overflow: "visible" }}
            onLayoutChanged={(_layout, { isUserInteraction }) => {
              if (isUserInteraction && showSidebar && sidebarPanel.current) {
                sidebarWidth.current = sidebarPanel.current.getSize().inPixels
              }
            }}
          >
            <Panel
              id="workspace-sidebar-panel"
              panelRef={sidebarPanel}
              defaultSize="15rem"
              minSize={showSidebar ? "12rem" : 0}
              maxSize={showSidebar ? "20rem" : 0}
              groupResizeBehavior="preserve-pixel-size"
              style={{ overflow: "visible" }}
              className="flex min-h-0 flex-col"
            >
              {sidebar}
            </Panel>
            <WorkspaceResizeHandle
              aria-label={`Resize ${navigationName} panel`}
              className={cn("hidden md:flex", !showSidebar && "md:hidden")}
              disabled={!showSidebar}
            />
            <Panel
              id="workspace-content-panel"
              minSize="20rem"
              className="relative flex min-h-0 flex-col"
              style={{ overflow: "visible" }}
            >
              {banner}
              <div className="flex min-h-0 flex-1">{children}</div>
            </Panel>
          </Group>
        </div>
      </div>
    </WorkspaceLayoutContext.Provider>
  )
}

export function WorkspaceSidebar({
  brand,
  children,
  actions,
  footer,
  label = "Topics",
}: {
  brand: ReactNode
  children: ReactNode
  actions?: ReactNode
  footer: ReactNode
  label?: string
}) {
  const { sidebarOpen, sidebarCollapsed, setSidebarOpen, sidebarId, navigationName } =
    useWorkspaceLayout()
  return (
    <>
      {sidebarOpen ? (
        <Button
          variant="plain"
          size="auto"
          aria-label={`Close ${navigationName}`}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        id={sidebarId}
        aria-label={label}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(19rem,85vw)] shrink-0 flex-col bg-sidebar transition-transform duration-200 motion-reduce:transition-none md:static md:h-full md:w-full md:translate-x-0 md:rounded-[1.75rem]",
          sidebarOpen
            ? "visible translate-x-0"
            : "invisible -translate-x-full md:visible",
          sidebarCollapsed && "md:hidden",
        )}
      >
        <div className="flex h-24 shrink-0 items-center justify-between px-5">
          {brand}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Close ${navigationName}`}
            className="size-9 rounded-full p-2 text-muted-foreground md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <XIcon className="size-5" />
          </Button>
        </div>
        <ScrollArea
          className="min-h-0 flex-1"
          viewportProps={{ className: "px-3 pb-5" }}
        >
          {children}
        </ScrollArea>
        {actions ? <div className="px-3 pb-3">{actions}</div> : null}
        <div className="mx-3 flex h-20 shrink-0 items-center gap-2 border-t border-sidebar-border px-1">
          {footer}
        </div>
      </aside>
    </>
  )
}

export function WorkspacePanes({
  body,
  chat,
  status,
  documentActions,
  chatLabel = "Chat",
}: {
  body: ReactNode
  chat?: ReactNode
  status?: ReactNode
  documentActions?: ReactNode
  chatLabel?: string
}) {
  const { chatOpen, documentCollapsed, chatCollapsed, setChatOpen } = useWorkspaceLayout()
  const desktopPanes = useWorkspaceMedia("(min-width: 64rem)")
  const showDocument = !desktopPanes || !chat || !documentCollapsed
  const showChat = desktopPanes && !!chat && !chatCollapsed
  const canResize = showDocument && showChat
  const chatPanel = usePanelRef()
  const chatSize = useRef("25rem")

  // Preserve the user's split while collapse and mobile drawers override panel sizes.
  useLayoutEffect(() => {
    if (canResize) chatPanel.current?.resize(chatSize.current)
  }, [canResize, chatPanel])

  return (
    <Group
      id="workspace-panes"
      className="min-h-0 min-w-0 flex-1"
      disabled={!canResize}
      style={{ overflow: "visible" }}
      onLayoutChanged={(layout, { isUserInteraction, requestedLayout }) => {
        if (isUserInteraction && canResize) {
          const preferredLayout = requestedLayout ?? layout
          chatSize.current = `${preferredLayout["workspace-chat-panel"]}%`
        }
      }}
    >
      <Panel
        id="workspace-document-panel"
        minSize={desktopPanes && showDocument ? "20rem" : 0}
        maxSize={showDocument ? "100%" : 0}
        className="flex min-h-0 flex-col"
      >
        <main
          id="learning-document"
          data-document-pane
          className={cn(
            "relative min-h-0 min-w-0 flex-1 overflow-hidden bg-card md:rounded-[1.75rem]",
            chat && documentCollapsed && "lg:hidden",
          )}
        >
          {documentActions}
          {body}
        </main>
      </Panel>
      <WorkspaceResizeHandle
        aria-label="Resize topic and chat panels"
        className={cn("hidden lg:flex", !canResize && "lg:hidden")}
        disabled={!canResize}
      />
      {chat && chatOpen ? (
        <Button
          variant="plain"
          size="auto"
          aria-label="Close chat"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setChatOpen(false)}
        />
      ) : null}
      <Panel
        id="workspace-chat-panel"
        panelRef={chatPanel}
        defaultSize="25rem"
        minSize={showChat ? "20rem" : 0}
        maxSize={showChat ? "100%" : 0}
        className="flex min-h-0 flex-col"
        style={{ overflow: "visible" }}
      >
        <aside
          id="learning-chat"
          aria-label={chatLabel}
          aria-hidden={!chat}
          inert={!chat}
          className={cn(
            "workspace-chat-pane fixed inset-y-0 right-0 z-40 flex w-[min(26rem,100vw)] flex-col overflow-hidden bg-sidebar transition-transform duration-200 motion-reduce:transition-none lg:static lg:h-full lg:w-full lg:translate-x-0 lg:rounded-[1.75rem]",
            chat && chatOpen
              ? "visible translate-x-0"
              : "invisible translate-x-full lg:visible",
            !chat && "hidden",
            chatCollapsed && "lg:hidden",
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-3 px-3 lg:sr-only">
            <span role="status" className="mr-auto text-xs text-muted-foreground">
              {status}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close chat"
              className="size-9 rounded-full p-2 text-muted-foreground lg:hidden"
              onClick={() => setChatOpen(false)}
            >
              <XIcon className="size-5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">{chat}</div>
        </aside>
      </Panel>
    </Group>
  )
}
