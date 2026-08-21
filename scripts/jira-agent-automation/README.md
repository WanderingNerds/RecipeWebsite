# Jira agent pipeline automation

Runs every 5 hours on your machine. Each run:

1. Skips entirely if the working tree isn't clean (never interferes with manual work in progress).
2. Finds the highest-priority Jira ticket assigned to you that isn't Done and isn't already "In Progress".
3. Creates a branch for it off `main`.
4. Runs it through this repo's existing pipeline (`.claude/agents/README.md`): **Planner -> Developer -> Reviewer -> Documentation** (QA is intentionally skipped, per your instruction - the repo's own pipeline includes a QA stage between Reviewer and Documentation if you ever want to turn it back on).
5. Commits everything **locally**. It never pushes and never opens a PR - review and push the branches yourself.
6. Switches back to `main` when done, so the repo isn't left sitting on a random ticket branch.

## Prerequisites

- `claude` CLI installed and already logged in on this machine (you confirmed this).
- The Atlassian Rovo MCP server connected in your Claude Code config, named `atlassian`, per `.claude/agents/README.md`'s "Connect it in Claude Code" section. Verify with:
  ```
  claude mcp list
  ```
  If it's not there yet:
  ```
  claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp
  ```
- Your Atlassian account needs `read_jira`, `write_jira`, and `search_jira` permissions (see the same README) so the agents can search, comment on, and transition tickets.

## Install

Open a normal PowerShell window (not the Cowork device bridge) and run:

```powershell
cd C:\Users\Carro\Desktop\RecipeWebsite\scripts\jira-agent-automation
.\install-scheduled-task.ps1
```

This registers a Windows Scheduled Task called **"RecipeWebsite - Jira Agent Pipeline"** under your own user account - no admin rights needed. It only runs while you're logged in.

## Test it once before trusting the schedule

```powershell
Start-ScheduledTask -TaskName "RecipeWebsite - Jira Agent Pipeline"
```

Then check the newest file in `logs\jira-agent-runs\`. Confirm: it picked the ticket you expected, created a sensible branch, and the commit looks right - **before** you let it run unattended for hours.

## Pause / resume / remove

```powershell
Disable-ScheduledTask -TaskName "RecipeWebsite - Jira Agent Pipeline"     # pause
Enable-ScheduledTask  -TaskName "RecipeWebsite - Jira Agent Pipeline"     # resume
Unregister-ScheduledTask -TaskName "RecipeWebsite - Jira Agent Pipeline" -Confirm:$false   # remove entirely
```

## Settings you'll likely want to tune

Open `run-workflow.ps1` and adjust the block near the top:

- `$BaseBranch` - defaults to `main`.
- `$InProgressName` - must exactly match the "in progress"-equivalent status in your Jira workflow; the search excludes tickets already in that status so the automation (or you, working manually) never gets double-picked. If your workflow uses a different label ("In Development", etc.), change this.
- `$LockStaleMins` - if a run is genuinely killed mid-flight (e.g. laptop sleeps), a lock older than this is treated as abandoned and cleared automatically. Default 90 minutes.
- `$MaxReviewLoops` - how many Developer <-> Reviewer rounds are allowed before the pipeline gives up and stops rather than looping forever.

## Read before you turn this on: what "unattended" actually means here

- **No push, ever.** Everything lands as local commits on a per-ticket branch. You still decide what actually goes to `origin`.
- **It only acts when your working tree is clean.** If you're mid-feature with uncommitted changes on whatever branch is checked out, every run that tick will just log "skipping" and exit - it will not stash, discard, or commit your own in-progress work on your behalf.
- **Unattended execution requires `--dangerously-skip-permissions`.** There's no human present to answer Claude Code's normal permission prompts, so this flag (or its current equivalent - check `claude --help`, it has changed names across versions) is required for the job to run at all. Combined with the fact that Jira ticket content is untrusted external text, this is a real prompt-injection surface: a malicious or compromised ticket could try to get the Developer agent (which has Bash access) to do something other than implement the ticket. The pipeline prompt explicitly tells every agent to treat Jira content as data, not instructions, and each agent's tool access is already scoped tightly in `.claude/agents/*.md` (Planner and Documentation can't touch code at all), but no prompt-level instruction is a perfect defense. Mitigations worth considering: run this under a Windows account with no more filesystem/network access than the repo needs, glance at `logs\jira-agent-runs\` periodically, and don't assign this Jira project to people/integrations you don't trust.
- **Every run writes a full log** to `logs\jira-agent-runs\<timestamp>.log` - stdout/stderr from the entire `claude -p` run, so you can audit exactly what happened even if you weren't watching.
- **QA is skipped**, per your choice - Reviewer is the only quality gate before Documentation runs. If you'd rather have QA back in the loop, edit the "STEP 3" section of the prompt in `run-workflow.ps1`.
