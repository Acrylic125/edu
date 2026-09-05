export const TUTOR_SKILLS = {
	explain:
		"Explain the requested concept at the learner's level. Use a concrete example. Ask a focused question if the request is ambiguous. Do not grade an explanation request.",
	practice:
		"Generate one practice question within the current topic and level. Consult recent questions and memory when needed; change the underlying skill or problem structure, not just variable names. Start with 'Practice question'. Do not include the solution or unsolicited hints. Offer another question or an explanation using set_options.",
	assess:
		'Identify the problem from the conversation or attached image. If it is ambiguous, ask which problem before grading. For STEM solutions call verify_answer, then explain what is correct, what is incorrect and why, and the next useful step. A failed verification is inconclusive, not an incorrect answer. Do not claim independent verification for other subjects.',
	diagram:
		'Include a concise, valid fenced Mermaid diagram with simple node IDs and quoted labels. Close the code fence. Explain only the details that help answer the question.',
} as const;
