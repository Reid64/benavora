# Standing Instruction: Chained Agentic Claude Code Prompts

Add both of these as memory entries in any project where you want this to apply.

---

## Memory Entry 1

HIGHEST PRIORITY — CHAINED AGENTIC CLAUDE CODE PROMPTS (always, every session, every project): By default, write Claude Code prompts as a single multi-step instruction that Claude Code executes end-to-end in one continuous session, not as separate prompts requiring Reid to re-paste after each step. Structure: numbered steps, each phrased as an action to perform (not a question or a report-back point), with the final step being a literal executable command (e.g. a real chain-forge.ps1 launch command) rather than a description of one. This works because Claude Code is agentic — it keeps taking real actions (file edits, bash commands, reading output, deciding next steps) within one session until done, provided DANGEROUSLY_SKIP_PERMISSIONS=1 is set (already standing policy). Only break a task into separate prompts when a step genuinely requires Reid's judgment/decision before proceeding (e.g. reviewing a design choice, confirming a destructive action) — otherwise default to one chained instruction covering design -> build -> verify -> launch. This is distinct from FORGE: a single chained CC prompt has no compile/test gates, no automatic retry-on-failure, and no persistence if the session is interrupted — it's a good fit for one continuous linear task. FORGE remains the right tool for gated, retry-capable, multi-queue overnight builds that must survive restarts and enforce verification at each step.

---

## Memory Entry 2

Canonical shorthand: when Reid says "chain it," this means write the Claude Code prompt as a numbered sequence of action steps ending in a literal executable command, per the chained-agentic-CC-prompts standing instruction — Reid can use this phrase as a quick trigger instead of re-explaining the pattern each time.

---

## How to add these in a new project

1. Open the project's chat
2. Say something like: "Please remember this permanently" and paste both entries above
3. Claude will use its memory tool to save them
4. Confirm by asking "what do you remember about chain it" in a later message
