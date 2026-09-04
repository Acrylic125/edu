import { describe, expect, it } from "vitest";

import {
	buildSystemContext,
	formatMessagesForModel,
	type AgentContext,
} from "./context";
import type { PersistedTopicMessage } from "../messages/schema";

describe("buildSystemContext", () => {
	it("instructs the agent to use Mermaid for requested diagrams", () => {
		const context: AgentContext = {
			userId: "user_1",
			topic: null,
			recentMessages: [],
			currentMessage: "Show me a state-machine diagram",
		};

		const instructions = buildSystemContext(context);

		expect(instructions).toContain("```mermaid");
		expect(instructions).toContain("Do not use ASCII art");
		expect(instructions).toContain(
			"Place the Mermaid diagram where it best supports the explanation",
		);
	});

	it("omits previous Mermaid source from model history", () => {
		const message: PersistedTopicMessage = {
			id: "message_1",
			topicId: "topic_1",
			role: "agent",
			parts: [
				{
					type: "text",
					content: "Diagram:\n```mermaid\nflowchart LR\nA --> B\n```\nDone.",
				},
			],
			createdAt: new Date("2026-09-04T00:00:00Z"),
		};

		const history = formatMessagesForModel([message]);

		expect(history).toContain("[Previous Mermaid diagram omitted]");
		expect(history).not.toContain("A --> B");
	});
});
