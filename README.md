<p align="center">
	<img src="desktop/src/renderer/assets/app-icon.png" alt="EdU logo, a stack of blue, green, and yellow books" width="160" />
</p>
<h1 align="center">EdU, Tutor Agent Harness</h1>
<p align="center">*MAC Only*</p>

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

### Tutor graph

Each learner turn is routed by the host. Eligible topic requests go directly to the topic role; other requests go through Tutor, which can delegate isolated topic, test, or generic work. The host validates and commits role changes before publishing the learner reply.

```mermaid
flowchart TB
	Thread["Learner turn"] --> Route["Host routes request"]
	Route -->|"eligible /new-topic"| Topic
	Route -->|"eligible confirmed-topic turn"| Topic
	Route -->|"other requests"| Prepare["Prepare coordinator context"]
	Prepare -->|"fits budget"| Tutor["Tutor: skill headers and coordination tools"]
	Prepare -->|"over budget"| Compact["Compact history and persist summary"]
	Compact --> Prepare
	Tutor -->|"delegate"| Assume["Host grants role jobs"]
	subgraph Roles["Isolated role subgraphs, parallel when independent"]
		Topic["Topic: indexed planner or scoped teaching"]
		Test["Test: assigned target and test tools"]
		Generic["Generic: assigned target and generic tools"]
	end
	Assume --> Topic
	Assume --> Test
	Assume --> Generic
	Topic --> Commit["Host validates and commits the batch"]
	Test --> Commit
	Generic --> Commit
	Commit -->|"one granted complete learner reply"| Publish["Host publishes stored reply and handoff"]
	Commit -->|"topic plan or planning clarification"| PlanReply["Host presents plan or clarification"]
	Commit -->|"summary or further coordination"| Prepare
	Tutor -->|"final reply"| Save["Host saves handoff and reply"]
	Publish --> Done(["Complete"])
	PlanReply --> Done
	Save --> Done
```

### Topic creation flow

Explicit `/new-topic` requests use one planner invocation. It selects sections from the local document index or researches suitable web sources. The host validates citations, commits the plan, and asks for confirmation; teaching begins after confirmation.

```mermaid
flowchart TD
    Request["Learner request + attachments"]
    Intent{"Explicit /new-topic request?"}
    Tutor["Tutor identifies intent and scope"]
    Sources{"Curriculum sources supplied?"}
    Index["Reuse document index<br/>Extract text and run local OCR on first use"]
    Planner["One planner invocation<br/>Identify scope and select section IDs"]
    Read["Host supplies selected source text<br/>Optional images for ambiguity"]
    Search["Planner searches suitable web sources"]
    Inspect["Host retrieves source pages<br/>Registers section IDs"]
    Submit["Planner submits title, section IDs, and goals"]
    Validate["Host constructs references<br/>Validates reviewed sections and stages the plan"]
    Commit["Commit topic and retain all attachments"]
    Confirm["Host renders saved plan and confirmation request"]
    Teach["After confirmation: guide current section"]
    Question["Select or generate the next question<br/>Adapt to the learner's response"]
    Clarify["Ask for missing scope or sources<br/>Create no topic"]

    Request --> Intent
    Intent -->|Yes| Sources
    Intent -->|No| Tutor
    Tutor -->|Create topic| Sources
    Tutor -->|Unclear| Clarify
    Sources -->|Yes| Index --> Planner
    Sources -->|No| Planner
    Planner -->|Select indexed sections| Read --> Submit
    Planner -->|No suitable source| Search --> Inspect --> Submit
    Planner -->|Missing scope or coverage| Clarify
    Submit --> Validate --> Commit --> Confirm
    Confirm -->|Revise| Planner
    Confirm -->|Confirmed| Teach --> Question --> Teach
```
