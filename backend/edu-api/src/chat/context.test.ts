import { describe, expect, it } from "vitest";

import { buildSystemContext, type AgentContext } from "./context";

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
	});
});
