param(
  [Parameter(Mandatory = $true)]
  [string]$CommitMessage,

  [switch]$StageAll,

  [string]$Remote = "origin",

  [string]$Branch = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not $Branch) {
  $Branch = (git rev-parse --abbrev-ref HEAD).Trim()
}

if ($StageAll) {
  git add -A | Out-Null
}

$stagedFiles = @(git diff --cached --name-only)
if ($stagedFiles.Count -eq 0) {
  throw "Khong co thay doi nao duoc stage. Hay stage truoc hoac dung -StageAll."
}

git commit -m $CommitMessage

$localHead = (git rev-parse HEAD).Trim()
git push $Remote $Branch

$remoteHead = ((git ls-remote $Remote "refs/heads/$Branch") | Select-Object -First 1)
if ($remoteHead) {
  $remoteHead = ($remoteHead -split "\s+")[0].Trim()
}

if (-not $remoteHead -or $remoteHead -ne $localHead) {
  Start-Sleep -Seconds 1
  git push $Remote $Branch
  $remoteHead = ((git ls-remote $Remote "refs/heads/$Branch") | Select-Object -First 1)
  if ($remoteHead) {
    $remoteHead = ($remoteHead -split "\s+")[0].Trim()
  }
}

if (-not $remoteHead -or $remoteHead -ne $localHead) {
  throw "Push verification failed: remote head khong khop local HEAD $localHead."
}

Write-Output "Published $localHead to $Remote/$Branch"
