import { describe, expect, it } from "vitest";

import { optionLabel, shortFocus } from "./option-label";

describe("shortFocus", () => {
	it("keeps a short label", () => {
		expect(shortFocus("Vectors")).toBe("Vectors");
	});

	it("pulls a noun from a plan paragraph", () => {
		expect(
			shortFocus(
				"Begin with vectors and vector operations, then study matrices.",
			),
		).toBe("Vectors");
	});

	it("falls back when empty", () => {
		expect(shortFocus("   ")).toBe("this topic");
	});
});

describe("optionLabel", () => {
	it("builds Explain Vectors", () => {
		expect(
			optionLabel(
				"Explain",
				"Begin with vectors and vector operations, then study matrices.",
			),
		).toBe("Explain Vectors");
	});
});
