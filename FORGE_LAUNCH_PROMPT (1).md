# FORGE Launch Prompt

Paste into a new Claude chat:

---

I need you to help me design a FORGE queue file for an autonomous build. FORGE is my PowerShell pipeline that feeds sequential prompts to Claude Code. It reads a queue.yaml, executes each prompt, runs compile/build gates, and commits on pass.

**Queue format (CRITICAL — must be flat `prompts:` list, never `phases:`):**

```yaml
project: benavora
github_repo: Reid64/benavora

settings:
  max_retries_per_prompt: 3
  build_model: claude-sonnet-4-6-20250514
  permission_mode: acceptEdits
  allowed_tools: "*"

prompts:
  - id: feature-001
    phase: build
    description: "What this prompt builds"
    prompt: |
      Read C:\Users\manag\Documents\benavora\src\existing\file.ts completely.

      Create C:\Users\manag\Documents\benavora\src\new\file.ts:
        Export class MyClass:
          - myMethod(arg: string): Promise<Result>
            What it does. Implementation details.
    expected_outputs:
      - src/new/file.ts
    gates:
      - type: compile
      - type: build
    max_retries: 3
    on_fail: halt
```

**Rules:**
- Every prompt starts with "Read..." to load context from existing files
- Full absolute Windows paths everywhere: `C:\Users\manag\Documents\PROJECT\...`
- Never put `npm install` inside prompts — pre-install before launch
- Prefix unused variables with `_` or ESLint kills the build
- Describe interfaces, not code — Claude Code writes the implementation

**Launch:**
```powershell
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; $env:DANGEROUSLY_SKIP_PERMISSIONS=1; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project PROJECT_NAME -startFrom 0
```

Queue file goes at: `C:\Users\manag\Documents\FORGE\projects\PROJECT_NAME\queue.yaml`

My project is at `C:\Users\manag\Documents\[PROJECT]` using [STACK]. Help me build a queue for: [DESCRIBE WHAT YOU WANT BUILT].
