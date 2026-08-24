"use client"

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react"
import { createStore, type StoreApi } from "zustand"
import { useStoreWithEqualityFn } from "zustand/traditional"
import { shallow } from "zustand/shallow"

import { upsertListing as upsertListingInCatalog } from "./catalog"
import { sendGate as computeSendGate } from "./gate"
import {
  handoffFromSession,
  NEW_CHAT_TITLE,
  reduceSession,
  topicIdFromWs,
} from "./session-reduce"
import {
  headerStatus as headerStatusFromState,
  selectShellPhase as selectShellPhaseFromState,
} from "./shell-phase"
import type {
  ChatBootstrap,
  ChatMessageAttachment,
  ChatStoreState,
  CurrentMessagesPayload,
  Gate,
  MessageId,
  TopicCatalog,
  TopicId,
  TopicListing,
} from "./types"
import type { WsServerMessage } from "./ws-schema"

export type ChatStore = ChatStoreState & {
  applyWs: (message: WsServerMessage) => void
  applySocketClosed: () => void
  stageUserMessage: (
    messageId: MessageId,
    content: string,
    attachments: ChatMessageAttachment[]
  ) => void
  stopLocal: () => void
  beginSwitch: (topicId: TopicId) => void
  commitSwitch: (payload: CurrentMessagesPayload) => void
  failSwitch: (message: string) => void
  replaceCurrentMessages: (payload: CurrentMessagesPayload) => void
  upsertListing: (listing: TopicListing) => void
  replaceCatalog: (catalog: TopicCatalog) => void
  sendGate: (
    draft: string,
    hasAttachments: boolean,
    attachmentsReady: boolean
  ) => Gate
  takeTopicBornRefresh: () => TopicId | null
}

type ChatStorePrivate = ChatStore & {
  topicBornRefresh: TopicId | null
}

const ChatStoreContext = createContext<StoreApi<ChatStorePrivate> | null>(null)

export function createChatStore(bootstrap: ChatBootstrap) {
  return createStore<ChatStorePrivate>((set, get) => ({
    catalog: bootstrap.catalog,
    session: bootstrap.session,
    socket: { status: "boot" },
    run: { status: "idle" },
    switch: null,
    revealed: false,
    topicBornRefresh: null,

    applyWs: (message) => {
      if (message.type === "ready") {
        set((state) => ({
          socket: { status: "ready", userId: message.userId },
          revealed: true,
          run: { status: "idle" },
          session: state.session,
        }))
        return
      }

      if (message.type === "error") {
        if (message.runId) {
          set({ run: { status: "idle" } })
          return
        }
        set((state) => {
          if (state.revealed) {
            return {
              socket: { status: "error", message: message.message },
              run: { status: "idle" },
            }
          }
          return {
            socket: { status: "error", message: message.message },
            run: { status: "idle" },
          }
        })
        return
      }

      const bornTopicId = topicIdFromWs(message)
      const state = get()
      let session = state.session
      let run = state.run
      let catalog = state.catalog
      let topicBornRefresh = state.topicBornRefresh

      if (bornTopicId) {
        const currentId =
          session.kind === "topic" ? session.topicId : null
        const isBirth =
          currentId === null ||
          currentId === "" ||
          currentId !== bornTopicId

        if (isBirth) {
          const previous = handoffFromSession(session)
          const born = reduceSession(session, run, {
            type: "topic_born",
            topicId: bornTopicId,
            previous,
          })
          session = born.session
          run = born.run
          catalog = upsertListingInCatalog(catalog, {
            id: bornTopicId,
            title: NEW_CHAT_TITLE,
            summary: "",
            createdAt: "",
            updatedAt: "",
          })
          topicBornRefresh = bornTopicId
        }
      }

      const reduced = reduceSession(session, run, {
        type: "ws",
        message,
      })

      set({
        session: reduced.session,
        run: reduced.run,
        catalog,
        topicBornRefresh,
      })
    },

    applySocketClosed: () => {
      set((state) => {
        const reduced = reduceSession(state.session, state.run, {
          type: "socket_closed",
        })
        return {
          socket: { status: "connecting" },
          session: reduced.session,
          run: reduced.run,
        }
      })
    },

    stageUserMessage: (messageId, content, attachments) => {
      set((state) => {
        const reduced = reduceSession(state.session, state.run, {
          type: "user_sent",
          messageId,
          content,
          attachments,
        })
        return {
          session: reduced.session,
          run: reduced.run,
        }
      })
    },

    stopLocal: () => {
      set({ run: { status: "idle" } })
    },

    beginSwitch: (topicId) => {
      set({ switch: { topicId } })
    },

    commitSwitch: (payload) => {
      set((state) => {
        const session = sessionFromPayload(payload)
        let catalog = state.catalog
        if (payload.topic !== null && catalog.byId[payload.topic.id] === undefined) {
          catalog = upsertListingInCatalog(catalog, {
            id: payload.topic.id,
            title: payload.topic.title,
            summary: "",
            createdAt: "",
            updatedAt: "",
          })
        }
        return {
          session,
          catalog,
          switch: null,
          run: { status: "idle" },
        }
      })
    },

    failSwitch: (_message) => {
      set({ switch: null })
    },

    replaceCurrentMessages: (payload) => {
      set((state) => {
        if (payload.topic === null) {
          return {
            session: { kind: "none" },
            topicBornRefresh: null,
          }
        }
        if (state.session.kind !== "topic") {
          return {
            session: {
              kind: "topic",
              topicId: payload.topic.id,
              title: payload.topic.title,
              messages: payload.messages,
              handoff: null,
            },
            topicBornRefresh: null,
          }
        }
        if (state.session.topicId !== payload.topic.id) {
          return state
        }
        return {
          session: {
            ...state.session,
            title: payload.topic.title,
            messages: payload.messages,
          },
          topicBornRefresh: null,
        }
      })
    },

    upsertListing: (listing) => {
      set((state) => ({
        catalog: upsertListingInCatalog(state.catalog, listing),
      }))
    },

    replaceCatalog: (catalog) => {
      set({ catalog })
    },

    sendGate: (draft, hasAttachments, attachmentsReady) => {
      const state = get()
      return computeSendGate(
        state.socket,
        state.run,
        draft,
        hasAttachments,
        attachmentsReady
      )
    },

    takeTopicBornRefresh: () => {
      const id = get().topicBornRefresh
      if (id === null) {
        return null
      }
      set({ topicBornRefresh: null })
      return id
    },
  }))
}

function sessionFromPayload(payload: CurrentMessagesPayload) {
  if (payload.topic === null) {
    return { kind: "none" as const }
  }
  return {
    kind: "topic" as const,
    topicId: payload.topic.id,
    title: payload.topic.title,
    messages: payload.messages,
    handoff: null,
  }
}

export function ChatStoreProvider({
  bootstrap,
  children,
}: {
  bootstrap: ChatBootstrap
  children: ReactNode
}) {
  const [store] = useState(() => createChatStore(bootstrap))
  return (
    <ChatStoreContext.Provider value={store}>
      {children}
    </ChatStoreContext.Provider>
  )
}

export function useChatStore<T>(selector: (state: ChatStorePrivate) => T) {
  const store = useContext(ChatStoreContext)
  if (!store) {
    throw new Error("useChatStore must be used within ChatStoreProvider")
  }
  // Selectors like selectShellPhase return fresh objects; Object.is would
  // trip React's getServerSnapshot cache check during SSR.
  return useStoreWithEqualityFn(store, selector, shallow)
}

export function useChatStoreApi() {
  const store = useContext(ChatStoreContext)
  if (!store) {
    throw new Error("useChatStoreApi must be used within ChatStoreProvider")
  }
  return store
}

export function selectShellPhase(state: ChatStoreState) {
  return selectShellPhaseFromState(state)
}

export function headerStatusSelector(state: ChatStoreState) {
  return headerStatusFromState(state)
}
