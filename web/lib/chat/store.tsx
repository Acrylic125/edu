"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { createStore, type StoreApi } from "zustand"
import { useStoreWithEqualityFn } from "zustand/traditional"
import { shallow } from "zustand/shallow"

import { upsertListing as upsertListingInCatalog } from "./catalog"
import { sendGate as computeSendGate } from "./gate"
import {
  handoffFromSession,
  NEW_CHAT_TITLE,
  reduceSession,
  titleFromContent,
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
  TopicTransitionDirection,
} from "./types"
import type { MessagePart, WsServerMessage } from "./ws-schema"

export type ChatStore = ChatStoreState & {
  applyWs: (message: WsServerMessage) => void
  applySocketClosed: () => void
  stageUserMessage: (
    messageId: MessageId,
    content: string,
    attachments: ChatMessageAttachment[],
  ) => void
  stageNewTopic: (
    messageId: MessageId,
    content: string,
    attachments: ChatMessageAttachment[],
    parts: MessagePart[],
  ) => void
  retryNewTopic: (messageId: MessageId) => void
  setOptionPending: (messageId: MessageId) => void
  stopLocal: () => void
  beginSwitch: (topicId: TopicId, direction: TopicTransitionDirection) => void
  commitSwitch: (payload: CurrentMessagesPayload) => void
  failSwitch: (message: string) => void
  replaceCurrentMessages: (payload: CurrentMessagesPayload) => void
  setCurrentStep: (stepId: string) => void
  setTopicDetails: (topic: NonNullable<CurrentMessagesPayload["topic"]>) => void
  upsertListing: (listing: TopicListing) => void
  replaceCatalog: (catalog: TopicCatalog) => void
  sendGate: (
    draft: string,
    hasAttachments: boolean,
    attachmentsReady: boolean,
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
    topicEntry: null,
    revealed: false,
    topicBornRefresh: null,
    topicCreation: null,
    optionState: null,
    error: null,

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

      const current = get()
      if (message.type === "error") {
        if (
          message.runId &&
          (current.run.status !== "running" ||
            current.run.runId !== message.runId)
        )
          return
        let session = current.session
        if (message.code === "limit_exceeded" && message.requestId && session.kind === "topic") {
          session = { ...session, messages: session.messages.filter((item) => item.id !== message.requestId) }
        }
        set({
          session,
          error: message.message,
          optionState: current.optionState
            ? { ...current.optionState, status: "failed" }
            : null,
          run:
            current.run.status === "running" && current.run.runId !== ""
              ? current.run
              : { status: "idle" },
          topicCreation: current.topicCreation
            ? {
                ...current.topicCreation,
                status: "failed",
                error: message.message,
              }
            : null,
        })
        return
      }
      if (message.type !== "run.started") {
        if (
          current.run.status !== "running" ||
          current.run.runId !== message.runId ||
          current.run.messageId !== message.messageId
        )
          return
      } else if (
        message.topicId &&
        current.session.kind === "topic" &&
        current.session.topicId &&
        current.session.topicId !== message.topicId &&
        current.run.status !== "running"
      ) {
        return
      }

      const bornTopicId = topicIdFromWs(message)
      const state = get()
      let session = state.session
      let run = state.run
      let catalog = state.catalog
      let topicBornRefresh = state.topicBornRefresh
      let topicCreation = state.topicCreation
      let optionState = state.optionState

      if (bornTopicId) {
        const previousTopicId =
          session.kind === "topic" ? session.handoff?.topicId : null
        if (
          topicCreation !== null &&
          message.type === "run.ended" &&
          bornTopicId === previousTopicId
        ) {
          topicCreation = {
            ...topicCreation,
            status: "failed",
            error: "The topic wasn't created. Please retry.",
          }
        }
        const currentId = session.kind === "topic" ? session.topicId : null
        const isBirth =
          (topicCreation === null || message.type === "run.ended") &&
          bornTopicId !== previousTopicId &&
          (currentId === null || currentId === "" || currentId !== bornTopicId)

        if (isBirth) {
          const previous = handoffFromSession(session)
          if (topicCreation !== null && session.kind === "topic") {
            session = { ...session, topicId: bornTopicId }
          } else {
            const born = reduceSession(session, run, {
              type: "topic_born",
              topicId: bornTopicId,
              previous,
            })
            session = born.session
            run = born.run
          }
          catalog = upsertListingInCatalog(catalog, {
            id: bornTopicId,
            title: session.kind === "topic" ? session.title : NEW_CHAT_TITLE,
            summary: "",
            createdAt: "",
            updatedAt: "",
          })
          topicBornRefresh = bornTopicId
          topicCreation = null
        }
      }

      if (
        topicCreation !== null &&
        message.type === "run.ended" &&
        !message.topicId
      ) {
        topicCreation = {
          ...topicCreation,
          status: "failed",
          error: "The topic wasn't created. Please retry.",
        }
      }

      const reduced = reduceSession(session, run, {
        type: "ws",
        message,
      })

      session = reduced.session
      if (optionState !== null && message.type === "run.ended") {
        const optionMessageId = optionState.messageId
        if (message.status === "completed") {
          if (session.kind === "topic") {
            session = {
              ...session,
              messages: session.messages.map((item) => {
                if (item.id !== optionMessageId) {
                  return item
                }
                return {
                  ...item,
                  parts: item.parts.filter((part) => part.type !== "options"),
                }
              }),
            }
          }
          optionState = null
        } else {
          optionState = { ...optionState, status: "failed" }
        }
      }

      set({
        session,
        run: reduced.run,
        catalog,
        topicBornRefresh,
        topicCreation,
        optionState,
      })
    },

    applySocketClosed: () => {
      set((state) => {
        if (state.socket.status === "ready") {
          return state
        }
        const reduced = reduceSession(state.session, state.run, {
          type: "socket_closed",
        })
        let topicCreation = state.topicCreation
        if (topicCreation) {
          topicCreation = {
            ...topicCreation,
            status: "failed",
            error:
              "The connection closed before the topic was created. Please retry.",
          }
        }
        return {
          socket: { status: "connecting" },
          session: reduced.session,
          run: reduced.run,
          topicCreation,
          optionState: state.optionState
            ? { ...state.optionState, status: "failed" }
            : null,
        }
      })
    },

    stageUserMessage: (messageId, content, attachments) => {
      set({ error: null })
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
          optionState: null,
        }
      })
    },

    setOptionPending: (messageId) => {
      set({ optionState: { messageId, status: "pending" } })
    },

    stageNewTopic: (messageId, content, attachments, parts) => {
      set((state) => {
        const previous = handoffFromSession(state.session)
        const started = reduceSession({ kind: "none" }, state.run, {
          type: "user_sent",
          messageId,
          content,
          attachments,
        })
        if (started.session.kind !== "topic") {
          return state
        }
        return {
          session: {
            ...started.session,
            title: titleFromContent(
              content.trim().replace(/^\/new(?:\s+|$)/, ""),
            ),
            handoff: previous,
          },
          run: started.run,
          topicEntry: { topicId: "", direction: "down" },
          topicCreation: { status: "creating", parts, error: null },
          optionState: null,
        }
      })
    },

    retryNewTopic: (messageId) => {
      set((state) => {
        if (!state.topicCreation || state.session.kind !== "topic") {
          return state
        }
        return {
          topicCreation: {
            ...state.topicCreation,
            status: "creating",
            error: null,
          },
          session: {
            ...state.session,
            messages: state.session.messages
              .filter((message) => message.role === "user")
              .map((message) => ({ ...message, id: messageId })),
          },
          run: { status: "running", runId: "", messageId: "" },
        }
      })
    },

    stopLocal: () => {
      set((state) => ({
        run: { status: "idle" },
        optionState: state.optionState
          ? { ...state.optionState, status: "failed" }
          : null,
        topicCreation: state.topicCreation
          ? {
              ...state.topicCreation,
              status: "failed",
              error: "The topic wasn't created. Please retry.",
            }
          : null,
      }))
    },

    beginSwitch: (topicId, direction) => {
      set({ switch: { topicId, direction }, topicEntry: null, optionState: null })
    },

    commitSwitch: (payload) => {
      set((state) => {
        const session = sessionFromPayload(payload)
        let catalog = state.catalog
        if (
          payload.topic !== null &&
          catalog.byId[payload.topic.id] === undefined
        ) {
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
          topicEntry: state.switch,
          run: { status: "idle" },
        }
      })
    },

    failSwitch: () => {
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
              summary: payload.topic.summary,
              plan: payload.topic.plan,
              updatedAt: payload.topic.updatedAt,
              messages: payload.messages,
              handoff: null,
              part: payload.topic.part,
              currentStepId: payload.topic.currentStepId,
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
            summary: payload.topic.summary,
            plan: payload.topic.plan,
            updatedAt: payload.topic.updatedAt,
            messages: payload.messages,
            part: payload.topic.part,
            currentStepId: payload.topic.currentStepId,
          },
          topicBornRefresh: null,
        }
      })
    },
    setCurrentStep: (stepId) => {
      set((state) => {
        if (state.session.kind !== "topic") {
          return state
        }
        return {
          session: {
            ...state.session,
            currentStepId: stepId,
          },
        }
      })
    },
    setTopicDetails: (topic) => {
      set((state) => {
        if (state.session.kind !== "topic" || state.session.topicId !== topic.id) {
          return state
        }
        const listing = state.catalog.byId[topic.id]
        return {
          session: {
            ...state.session,
            title: topic.title,
            summary: topic.summary,
            plan: topic.plan,
            part: topic.part,
            currentStepId: topic.currentStepId,
            updatedAt: topic.updatedAt,
          },
          catalog: upsertListingInCatalog(state.catalog, {
            id: topic.id,
            title: topic.title,
            summary: topic.summary,
            createdAt: listing?.createdAt ?? "",
            updatedAt: topic.updatedAt,
          }),
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
        attachmentsReady,
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
    summary: payload.topic.summary,
    plan: payload.topic.plan,
    updatedAt: payload.topic.updatedAt,
    messages: payload.messages,
    handoff: null,
    part: payload.topic.part,
    currentStepId: payload.topic.currentStepId,
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

export function useOptionalChatStoreApi() {
  return useContext(ChatStoreContext)
}

export function selectShellPhase(state: ChatStoreState) {
  return selectShellPhaseFromState(state)
}

export function headerStatusSelector(state: ChatStoreState) {
  return headerStatusFromState(state)
}
