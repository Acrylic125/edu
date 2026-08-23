import { describe, expect, it } from "vitest";

import { flushWords, pushWords, takeWordChunk } from "./word-buffer";

describe("takeWordChunk", () => {
	it.each([
		{ name: "empty", pending: "", chunk: "", rest: "" },
		{
			name: "7 words",
			pending: "one two three four five six seven ",
			chunk: "",
			rest: "one two three four five six seven ",
		},
		{
			name: "8 words",
			pending: "one two three four five six seven eight ",
			chunk: "one two three four five six seven eight ",
			rest: "",
		},
		{
			name: "8 with no trailing space",
			pending: "one two three four five six seven eight",
			chunk: "",
			rest: "one two three four five six seven eight",
		},
		{
			name: "extra whitespace",
			pending: "one  two\tthree\nfour  five six seven eight  ",
			chunk: "one  two\tthree\nfour  five six seven eight  ",
			rest: "",
		},
	])("$name", ({ pending, chunk, rest }) => {
		expect(takeWordChunk(pending)).toEqual({ chunk, rest });
	});
});

describe("flushWords", () => {
	it("flushes remainder under eight words", () => {
		const pushed = pushWords("", "one two three");
		expect(pushed.flush).toBe("");
		expect(pushed.pending).toBe("one two three");
		expect(flushWords(pushed.pending)).toEqual({
			pending: "",
			flush: "one two three",
		});
	});
});
