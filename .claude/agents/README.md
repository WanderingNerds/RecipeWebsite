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

## Atlassian access (Atlassian Rovo MCP Server)

These agents connect to Jira/Confluence via Atlassian's official **Rovo MCP Server** (`mcp.atlassian.com`), not a third-party connector. Every tool name in the `tools:` frontmatter (`getJiraIssue`, `createConfluencePage`, etc.) is copied verbatim from Atlassian's [supported tools list](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/).

### Connect it in Claude Code

The old `/v1/sse` endpoint stopped working after June 30, 2026. Use the current endpoint and name the server exactly `atlassian` so the tool names below resolve (`mcp__atlassian__<toolName>`):

```
claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp
```

First use will trigger an OAuth 2.1 browser login (or configure an API token instead — see Atlassian's [authentication docs](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/authentication-and-authorization/)). If you name the server something other than `atlassian`, find-and-replace the `mcp__atlassian__` prefix in all five agent files to match.

### cloudId bootstrap

Every Rovo MCP Jira/Confluence tool call requires a `cloudId`. Each agent is instructed to call `getAccessibleAtlassianResources` once, first, and reuse the returned `cloudId` for the rest of its Atlassian calls in that session — this is built into each agent's prompt already.

### Access by agent

| Agent | Jira | Confluence | Jira used for | Confluence used for |
|---|---|---|---|---|
| Planner | read-only | read/write | pulling ticket context into the plan | creating/updating the plan/architecture page, linked from Jira |
| Developer | read/write | none | creating tickets if missing, transitions, comments, worklogs, linking follow-up tickets | — |
| Reviewer | read/write | none | filing linked, assigned bug tickets for blocking issues; transitions; comments | — |
| QA | read/write | none | filing linked, assigned bug tickets for failures; transitions; comments; worklogs | — |
| Documentation | read + comment | read/write | commenting the Confluence link back onto every issue touched | final as-shipped write-up, architecture/API/DB pages |

Only Planner and Documentation touch Confluence. Developer, Reviewer, and QA use Jira purely to keep ticket state, tracking, and assignment honest — none of them write docs.

### Permissions your org admin must grant

Rovo MCP gates tools by permission group. For this pipeline to work end-to-end, your Atlassian org needs `read_jira`, `write_jira`, `search_jira`, `read_confluence`, `write_confluence`, and `search_confluence` enabled for the connecting account (Confluence write only needs to reach Planner and Documentation, but Rovo MCP grants by account, not per-agent).

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
