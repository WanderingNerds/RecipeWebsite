# RecipeWebsite orchestrator — setup & workflow

## Install

Copy this folder's `.md` files into your repo at `.claude/agents/` (create the folder if it doesn't exist):

```
RecipeWebsite/
  .claude/
    agents/
      planner.md
      developer.md
      reviewer.md
      qa.md
      documentation.md
```

Claude Code (and Claude in Cowork, via the Agent tool) will auto-discover them by the `name:` in each file's frontmatter.

## Stack correction

The original brief specified React for the Developer agent. The actual repo is **Node.js + Express 5 (ES modules) with server-rendered EJS views and Supabase (Postgres + Auth)** — there's no React anywhere in the codebase. All five agent prompts below are written against the real stack. If a React frontend is planned for later, say so and these prompts should be updated.

## The pipeline

```
User request
     |
     v
 [Planner]  -> docs/plans/<feature-slug>.md (tasks, files, acceptance criteria)
     |
     v
[Developer] -> implements exactly per plan, produces change summary
     |
     v
[Reviewer]  -> bugs / security / performance / maintainability
     |            |
     |     Blocking issues? --> back to Developer
     v
   (approved)
     |
     v
   [QA]      -> tests acceptance criteria, runs npm test, security checks
     |            |
     |     Failures? --> back to Developer (CC Reviewer if missed in review)
     v
   (passed)
     |
     v
[Documentation] -> README, API docs, DB docs, release notes, Confluence/Jira
```

## Running it

Invoke each stage in order via the Agent tool, passing the prior stage's output forward:

1. "Use the planner agent to plan: <feature request>"
2. "Use the developer agent to implement the plan in docs/plans/<slug>.md"
3. "Use the reviewer agent to review that change"
4. If approved: "Use the qa agent to verify docs/plans/<slug>.md acceptance criteria"
5. If passed: "Use the documentation agent to document this completed change"

If Reviewer or QA send work back to Developer, loop steps 2-4 until both pass before moving to Documentation.

## Conventions all agents share

- Plans live in `docs/plans/<feature-slug>.md`
- New DB changes are new files in `database/migrations/`, never edits to applied migrations
- Tests are co-located `*.test.js`, run via `npm test` (Node's built-in test runner)
- Security middleware (helmet, csrf-csrf, express-rate-limit, auth middleware) is a hard boundary — no agent weakens it to make something "work"
- Only the Developer and QA agents may write files that aren't documentation; Planner and Reviewer are read-only/advisory
