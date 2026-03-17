$ErrorActionPreference = "Stop"

$scriptPath = $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptPath)
$runnerEnvPath = Join-Path $repoRoot ".env.link-check-runner.local"
$logDir = Join-Path $repoRoot "logs\link-check-runner"
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logPath = Join-Path $logDir "link-check-$timestamp.log"

if (-not (Test-Path $runnerEnvPath)) {
  throw "Missing runner env file: $runnerEnvPath"
}

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

Push-Location $repoRoot
try {
  Get-Content $runnerEnvPath | ForEach-Object {
    if (-not $_ -or $_.TrimStart().StartsWith("#")) {
      return
    }

    $separatorIndex = $_.IndexOf("=")
    if ($separatorIndex -lt 1) {
      return
    }

    $name = $_.Substring(0, $separatorIndex).Trim()
    $value = $_.Substring($separatorIndex + 1).Trim().Trim('"')
    Set-Item -Path "Env:$name" -Value $value
  }

  if (-not $env:LINK_CHECK_URL) {
    throw "LINK_CHECK_URL is missing in $runnerEnvPath"
  }

  if (-not $env:LINK_CHECK_AUTOMATION_TOKEN) {
    throw "LINK_CHECK_AUTOMATION_TOKEN is missing in $runnerEnvPath"
  }

  Remove-Item Env:LINK_CHECK_DEPLOYMENT_URL -ErrorAction SilentlyContinue
  if ($env:LINK_CHECK_URL -match "https://www\.workdocker\.com/api/check-links/?$") {
    $vercelCliPath = Join-Path $env:APPDATA "npm\vercel.cmd"
    $vercelCommand = if (Test-Path $vercelCliPath) {
      '"' + $vercelCliPath + '" ls --yes 2>nul'
    } else {
      'vercel ls --yes 2>nul'
    }
    $latestDeploymentUrl = (& cmd /c $vercelCommand | Where-Object { $_ -match '^https://[^\s]+\.vercel\.app/?$' } | Select-Object -First 1)
    if ($latestDeploymentUrl) {
      $env:LINK_CHECK_DEPLOYMENT_URL = $latestDeploymentUrl.Trim().TrimEnd("/")
    }
  }

  if (-not $env:LINK_CHECK_LIMIT) {
    $env:LINK_CHECK_LIMIT = "400"
  }

  if (-not $env:NODE_TLS_REJECT_UNAUTHORIZED) {
    $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
  }

  $output = & cmd /c "node scripts\\link-check-browser-runner.mjs 2>&1"
  $outputText = ($output | Out-String).Trim()

  @(
    "[$(Get-Date -Format s)] Workdocker local link check runner"
    "Repo: $repoRoot"
    "Link check URL: $env:LINK_CHECK_URL"
    "Deployment URL: $env:LINK_CHECK_DEPLOYMENT_URL"
    "Output:"
    $outputText
  ) | Set-Content $logPath

  if ($LASTEXITCODE -ne 0) {
    throw "Local link check runner failed. See $logPath"
  }
} finally {
  Pop-Location
}
