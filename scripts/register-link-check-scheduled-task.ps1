$ErrorActionPreference = "Stop"

$scriptPath = $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptPath)
$runnerScriptPath = (Resolve-Path (Join-Path $repoRoot "scripts\run-link-check-local.ps1")).Path
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerScriptPath`""

$taskDefinitions = @(
  @{ Name = "Workdocker Link Check 09"; Time = "09:00" },
  @{ Name = "Workdocker Link Check 14"; Time = "14:00" },
  @{ Name = "Workdocker Link Check 22"; Time = "22:00" }
)

foreach ($task in $taskDefinitions) {
  schtasks /Create /TN $task.Name /TR $taskCommand /SC DAILY /ST $task.Time /F | Out-Null
  Write-Host "Registered scheduled task: $($task.Name)"
}
