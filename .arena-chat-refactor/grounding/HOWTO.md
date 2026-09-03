# Grounding (from how explorers)

- Page RSC Suspense → loadCurrentChatSnapshot → ChatWorkspace useState
- chats[] multi-capable but UI is single active chat; createChat/selectChat/sidebar unused
- withTopic remaps chat.id to topicId IN PLACE keeping old messages → bug on new topic in-session
- Backend: GET /topics, GET /topics/current/messages, POST /topics/:id/select — web only uses current/messages
- nanoid/zustand not in web/package.json; backend uses nanoid
- WS binds topic via getCurrentTopic; client messages have no topicId
- User wants: nanoid; server-first; skeleton shell for load+connecting; only current topic messages; previous-topic button; composer dropdown to select topic; zustand shared state
