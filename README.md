<p align="center">
	<img src="desktop/src/renderer/assets/app-icon.png" alt="EdU logo, a stack of blue, green, and yellow books" width="160" />
</p>
<h1 align="center">EdU, Tutor Agent Harness</h1>
<p align="center">Alpha Release, M-Series Macs Only</p>

## Why?

Do you **really understand** what your prof is trying to say? Bloated and outdated slides makes it hard for you to tell what needs to be understood.

We resort to tools like ChatGPT, Gemini, and Claude to try to help us clarify and evaluate our understanding. However, 
- Verbose responses drains you.
- Your understanding is not validated as you progress.
- Explanations misalign with what needs to be understood.
- No understanding of your progress and past mistakes.
- Shallow evaluation, gives you a false sense of confidence in understanding.

**EdU guides your understanding.**

## EdU's Principles

The agent is designed from 3 principles:
- **Use what exists, don't make shit up.** Prioritises walkthroughs, checks and questions based on what you give. Else, find it online.
- **Deliberation guides understanding** Don't assume correctness. Ask clarification, give edge cases, ask for validation.
- **Don't overwhelm** Chunk part by part, not all at once.

## Features

### The Scratchpad
The scratchpad is where the Tutor documents your understanding. 

3 Types,
- **Topic**, Course content walkthrough guides.
- **Test**, Like a typical test.
- **Generic**, Anything else.

### Topic Walkthrough
Attach your course slides, tutorials, past year papers and walk through. 

It goes:
1. Create topic, `/new-topic <topic>`
2. Proposes plan, you accept or amend
3. Explain part by part. After each part, asks for a check

When you make a mistake, it gets documented.

### Tests
`@Tag` the topic / ask it what you want to be tested on. Based on your past mistakes, sources questions from online or based on your attached resources that evaluates those mistakes.

It goes:
1. Create test, `/new-test <topic>`
3. Ask question by question.

### Tutor Agent Runners
Use your existing AI subscription (Use whats provided by your school of course!), **EdU is only a Harness**.

Supports
- Codex
- Claude Code
- Antigravity

## Architecture