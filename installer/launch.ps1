param([ValidateSet('start', 'doctor', 'setup', 'login', 'login-codex', 'dashboard', 'service-install', 'claw')][string]$Command = 'start')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$name = (Get-Content -Raw -LiteralPath (Join-Path $root 'active-release.txt')).Trim()
if ($name -notmatch '^\d+\.\d+\.\d+-[a-f0-9]+$') { throw 'Invalid active release.' }
$release = Join-Path $root "releases/$name"
$env:PATH = (Join-Path $release 'runtime') + ';' + $env:PATH
$env:ACCOUNT_CLAW_OPENCLAW = Join-Path $release 'backend/node_modules/openclaw/openclaw.mjs'
$env:ACCOUNT_CLAW_DATA_DIR = Join-Path $root 'data'
$env:ACCOUNT_CLAW_WORKSPACE_DIR = Join-Path $root 'workspace'
& (Join-Path $release 'runtime/node.exe') (Join-Path $release 'app/claw/cli.mjs') $Command @args
exit $LASTEXITCODE
