# SAFE TO RUN
# PowerShell wrapper for Hydra Ensemble smoke test (Windows).
# Verifies Node is available, then delegates to scripts/smoke.mjs.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "'node' not found on PATH. Install Node.js 20+ before running smoke tests."
    exit 1
}

if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
    Write-Error "node_modules\ missing. Run `npm install` (and `npm run rebuild`) first."
    exit 1
}

& node (Join-Path $ScriptDir 'smoke.mjs') @args
exit $LASTEXITCODE
