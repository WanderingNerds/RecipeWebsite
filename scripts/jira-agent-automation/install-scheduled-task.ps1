<#
One-time setup. Registers a Windows Scheduled Task that runs run-workflow.ps1
every 5 hours, starting now, only while you're logged on to this machine.

Run this once from a normal PowerShell window (not this bridge):

    cd C:\Users\Carro\Desktop\RecipeWebsite\scripts\jira-agent-automation
    .\install-scheduled-task.ps1

Re-run it any time to refresh the registration (e.g. after moving the repo).
No admin rights are required - it registers the task under your own user account.
#>

$ErrorActionPreference = "Stop"

$TaskName   = "RecipeWebsite - Jira Agent Pipeline"
$ScriptPath = Join-Path $PSScriptRoot "run-workflow.ps1"

if (-not (Test-Path $ScriptPath)) {
    throw "Can't find run-workflow.ps1 next to this installer at $ScriptPath"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

# Omitting -RepetitionDuration here is deliberate: with -RepetitionInterval set and no
# duration, Task Scheduler repeats indefinitely. (Passing [TimeSpan]::MaxValue explicitly
# produces a duration string the Task Scheduler XML schema rejects - this is the fix for
# that, not an oversight.)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
             -RepetitionInterval (New-TimeSpan -Hours 5)

$settings = New-ScheduledTaskSettingsSet `
              -MultipleInstances IgnoreNew `
              -StartWhenAvailable `
              -DontStopOnIdleEnd `
              -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName `
                        -Action $action `
                        -Trigger $trigger `
                        -Settings $settings `
                        -Description "Every 5 hours: checks Jira for the highest-priority open ticket assigned to Andrew Carroll and runs it through the Planner/Developer/Reviewer/Documentation agent pipeline, committing locally (no push)." `
                        -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName'."
Write-Host "It runs under your current Windows user account, only while you're logged on, every 5 hours."
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Run it once right now (test):  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Check its status:              Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "  Pause it:                      Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Resume it:                     Enable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove it entirely:            Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host ""
Write-Host "Logs land in .\logs\jira-agent-runs\ (one timestamped file per run)."
