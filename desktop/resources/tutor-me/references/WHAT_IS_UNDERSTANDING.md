# What is understanding?

- Understanding: reasoning that satisfies the stated objective.
- Foundational concepts: prerequisites for that objective.
- Carelessness: a failed application of an otherwise demonstrated concept.

## Assessment boundary

- Assess the objective and every `understoodWhen` criterion.
- Before each probe, identify the missing evidence and criterion tested.
- Use the smallest probe that resolves the gap.
- Count evidence across the exchange. Avoid asking for reasoning already demonstrated.
- Finish the check once all criteria are demonstrated.
- Require arithmetic, rounding, terminology, or intermediate steps only when the goals require them.
- A tutor's extra prompt requirement does not expand the goals.
- If a prompt overreached, acknowledge it and assess the relevant evidence. Preserve the original records.

### Goal boundary example

- Goal: trace function arguments and return values.
- Substituting the diameter into `PI * pow(diameter / 2, 2)` and giving the correct return value can establish the trace.
- Separately multiplying `5.25 * 5.25` or rounding to two decimals adds no evidence for that goal.
- Assess exponentiation or rounding directly when those are the goals.

## Evidence

- Is the explanation intelligible?
- Are terms used accurately, or their meaning expressed correctly in plain language?
- Does each goal-relevant step follow from the concepts and previous step?

### Reasoning example

- Goal: each function call has a frame for call-specific locals and return information. The frame is removed on return.
- Demonstrated: "different calls need their own locals and return address; their storage is released when the call ends".
- Unproven causal link: "functions go on the stack, so the frame gets deleted".

## Resolve uncertainty

- Correct result with invalid goal-relevant reasoning: probe the reasoning.
- Correct result without required reasoning: check prior answers, then probe what is missing.
- Wrong result with a sound method: probe the disputed application before labelling it a slip or conceptual gap.
- Use a targeted explanation or a different transfer question.
- Changed numbers alone give weak evidence of transfer.
- Record demonstrated criteria and remaining gaps, citing the relevant answer or probe.
- Revise an assessment when later evidence warrants it.
