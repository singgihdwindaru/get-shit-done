---
name: gsd:review
description: Request cross-AI peer review of phase plans from external AI CLIs
argument-hint: "--phase N [--gemini] [--codex] [--all]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<objective>
Invoke external AI CLIs (Gemini, Codex) to independently review phase plans.
Produces a structured REVIEWS.md with per-reviewer feedback that can be fed back into
planning via /gsd-plan-phase --reviews.

**Flow:** Detect CLIs → Build review prompt → Invoke each CLI → Collect responses → Write REVIEWS.md
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/review.md
</execution_context>

<context>
Phase number: extracted from $ARGUMENTS (required)

**Flags:**
- `--gemini` — Include Gemini CLI review
- `--codex` — Include Codex CLI review
- `--all` — Include all available CLIs
</context>

<process>
Execute the review workflow from @~/.copilot/get-shit-done/workflows/review.md end-to-end.
</process>
