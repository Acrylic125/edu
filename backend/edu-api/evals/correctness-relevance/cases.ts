import { z } from "zod";

export const TutorEvalCaseSchema = z.object({
	id: z.string().min(1),
	category: z.enum([
		"concept-explanation",
		"calculation",
		"misconception-correction",
		"contextual-follow-up",
	]),
	context: z.object({
		topic: z.string(),
		summary: z.string(),
		currentFocus: z.string(),
	}),
	input: z.string().min(1),
	referenceAnswer: z.string().min(1),
	correctnessCriteria: z.array(z.string().min(1)).min(1),
	relevanceCriteria: z.array(z.string().min(1)).min(1),
	disallowedClaims: z.array(z.string().min(1)),
});

export type TutorEvalCase = z.infer<typeof TutorEvalCaseSchema>;

export const correctnessRelevanceCases = TutorEvalCaseSchema.array().parse([
	{
		id: "dfa-definition",
		category: "concept-explanation",
		context: {
			topic: "Finite automata and regular languages",
			summary: "DFAs, NFAs, regular expressions, and closure properties",
			currentFocus: "Deterministic finite automata",
		},
		input: "What makes a finite automaton deterministic?",
		referenceAnswer:
			"A DFA has exactly one transition for every state and input symbol, has no epsilon transitions, and therefore has one computation path for an input string.",
		correctnessCriteria: [
			"States that each state/input-symbol pair has exactly one transition.",
			"Does not claim that a DFA can choose between transitions.",
		],
		relevanceCriteria: [
			"Answers the meaning of deterministic directly.",
			"Keeps the explanation focused on finite automata.",
		],
		disallowedClaims: ["A DFA may use epsilon transitions."],
	},
	{
		id: "dfa-trace",
		category: "contextual-follow-up",
		context: {
			topic: "Finite automata and regular languages",
			summary: "DFAs, NFAs, regular expressions, and closure properties",
			currentFocus: "Tracing strings through a DFA",
		},
		input:
			"If the start state is q0, reading 1 goes to q1, and reading 0 from q1 stays at q1, where do we end after 100?",
		referenceAnswer:
			"The run is q0 --1--> q1 --0--> q1 --0--> q1, so it ends at q1.",
		correctnessCriteria: [
			"Concludes that the final state is q1.",
			"Applies all three symbols in order.",
		],
		relevanceCriteria: [
			"Shows or concisely describes the state sequence.",
			"Does not introduce acceptance criteria that were not provided.",
		],
		disallowedClaims: ["The string is accepted without knowing whether q1 is accepting."],
	},
	{
		id: "nfa-misconception",
		category: "misconception-correction",
		context: {
			topic: "Finite automata and regular languages",
			summary: "DFAs, NFAs, regular expressions, and closure properties",
			currentFocus: "Nondeterministic finite automata",
		},
		input: "An NFA is more powerful than a DFA because it has more choices, right?",
		referenceAnswer:
			"No. NFAs and DFAs recognize exactly the regular languages. NFAs can be more concise, but every NFA can be converted to an equivalent DFA by subset construction.",
		correctnessCriteria: [
			"States that NFAs and DFAs have equal expressive power.",
			"Distinguishes succinctness from expressive power.",
		],
		relevanceCriteria: [
			"Corrects the misconception explicitly.",
			"Explains why the extra choices do not recognize a larger language class.",
		],
		disallowedClaims: ["NFAs recognize non-regular languages."],
	},
	{
		id: "regex-language",
		category: "concept-explanation",
		context: {
			topic: "Finite automata and regular languages",
			summary: "DFAs, NFAs, regular expressions, and closure properties",
			currentFocus: "Regular expressions",
		},
		input: "What language does (0|1)*01 describe?",
		referenceAnswer:
			"It describes all binary strings ending in 01, including 01 itself.",
		correctnessCriteria: [
			"Identifies binary strings whose final two symbols are 01.",
			"Recognizes that the prefix may be any binary string, including empty.",
		],
		relevanceCriteria: [
			"Describes the language in plain language.",
			"Includes at most a few useful examples or counterexamples.",
		],
		disallowedClaims: ["The expression describes strings beginning with 01."],
	},
	{
		id: "linear-equation",
		category: "calculation",
		context: {
			topic: "Linear equations",
			summary: "Solving one-variable linear equations",
			currentFocus: "Inverse operations",
		},
		input: "Solve 3x - 7 = 11.",
		referenceAnswer: "Add 7 to get 3x = 18, then divide by 3, giving x = 6.",
		correctnessCriteria: [
			"Concludes x = 6.",
			"Uses valid equivalent operations or verifies the answer by substitution.",
		],
		relevanceCriteria: [
			"Shows enough reasoning for a learner to follow.",
			"Does not add unrelated algebra topics.",
		],
		disallowedClaims: ["x = 4", "x = 18"],
	},
	{
		id: "derivative-power-rule",
		category: "calculation",
		context: {
			topic: "Differentiation",
			summary: "Limits, derivatives, and differentiation rules",
			currentFocus: "Power rule",
		},
		input: "Differentiate f(x) = 4x^3 - 2x + 5.",
		referenceAnswer: "f'(x) = 12x^2 - 2.",
		correctnessCriteria: [
			"Returns 12x^2 - 2.",
			"Treats the derivative of the constant as zero.",
		],
		relevanceCriteria: [
			"Applies the power rule directly.",
			"Avoids unnecessary discussion of integration or limits.",
		],
		disallowedClaims: ["The derivative of 5 is 5."],
	},
	{
		id: "probability-without-replacement",
		category: "calculation",
		context: {
			topic: "Probability",
			summary: "Conditional probability and dependent events",
			currentFocus: "Sampling without replacement",
		},
		input:
			"A bag has 3 red and 2 blue balls. What is the probability of drawing two red balls without replacement?",
		referenceAnswer: "(3/5)(2/4) = 6/20 = 3/10.",
		correctnessCriteria: [
			"Returns 3/10 or 0.3.",
			"Changes the second denominator and red count after the first draw.",
		],
		relevanceCriteria: [
			"Explains the dependence created by not replacing the first ball.",
			"Does not solve a with-replacement variant instead.",
		],
		disallowedClaims: ["The probability is 9/25."],
	},
	{
		id: "newton-third-law",
		category: "misconception-correction",
		context: {
			topic: "Newtonian mechanics",
			summary: "Forces, free-body diagrams, and Newton's laws",
			currentFocus: "Newton's third law",
		},
		input:
			"If action and reaction forces are equal, shouldn't they cancel and prevent motion?",
		referenceAnswer:
			"Third-law pairs act on different objects, so they do not cancel on one object's free-body diagram. Motion depends on the net force acting on each individual object.",
		correctnessCriteria: [
			"States that the force pair acts on different objects.",
			"Distinguishes a third-law pair from forces summed on one object.",
		],
		relevanceCriteria: [
			"Addresses the cancellation misconception directly.",
			"Uses an example only if it clarifies which force acts on which object.",
		],
		disallowedClaims: ["Equal and opposite forces always produce zero acceleration."],
	},
	{
		id: "binary-search-complexity",
		category: "concept-explanation",
		context: {
			topic: "Algorithms",
			summary: "Searching, sorting, and asymptotic complexity",
			currentFocus: "Binary search",
		},
		input: "Why is binary search O(log n)?",
		referenceAnswer:
			"Each comparison halves the remaining search interval. After k comparisons about n/2^k elements remain, so reaching one element requires k proportional to log2(n).",
		correctnessCriteria: [
			"Connects logarithmic complexity to repeatedly halving the search space.",
			"Does not claim binary search works on arbitrary unsorted input.",
		],
		relevanceCriteria: [
			"Explains the complexity rather than merely stating it.",
			"Mentions the sorted-data prerequisite if discussing applicability.",
		],
		disallowedClaims: ["Binary search is O(log n) on an unsorted array without preprocessing."],
	},
	{
		id: "stay-on-current-focus",
		category: "contextual-follow-up",
		context: {
			topic: "Finite automata and regular languages",
			summary: "DFAs, NFAs, regular expressions, and closure properties",
			currentFocus: "DFA transition functions",
		},
		input: "Can you give me another example?",
		referenceAnswer:
			"Provide a new, concrete DFA transition-function example that remains within DFA transition functions and is meaningfully different from the prior example.",
		correctnessCriteria: [
			"Any stated transitions are internally consistent and deterministic.",
			"The example has no more than one transition per state/input-symbol pair.",
		],
		relevanceCriteria: [
			"Interprets 'another' using the current focus.",
			"Does not switch to an unrelated subject or a later curriculum unit.",
		],
		disallowedClaims: ["A transition table may contain two destinations for the same DFA state and symbol."],
	},
]);
