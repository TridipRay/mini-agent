param([ValidateSet('start', 'doctor', 'setup-sandbox')][string]$Command = 'start')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$name = (Get-Content -Raw -LiteralPath (Join-Path $root 'active-release.txt')).Trim()
if ($name -notmatch '^\d+\.\d+\.\d+-[a-f0-9]+$') { throw 'Invalid active release.' }
$release = Join-Path $root "releases/$name"
$binary = (Get-Content -Raw -LiteralPath (Join-Path $release 'backend-path.txt')).Trim()
if ($binary -notmatch '^backend/node_modules/@openai/codex-win32-(x64|arm64)/vendor/(x86_64|aarch64)-pc-windows-msvc/bin/codex\.exe$') { throw 'Invalid backend path.' }
$env:PATH = (Join-Path $release 'runtime') + ';' + $env:PATH
$env:MINI_AGENT_CODEX_BIN = Join-Path $release $binary
$env:MINI_AGENT_DATA_DIR = Join-Path $root 'data'
$env:MINI_AGENT_WORKSPACE_DIR = Join-Path $root 'workspace'
if ($Command -eq 'setup-sandbox') {
    & (Join-Path $release 'runtime/node.exe') (Join-Path $release 'app/scripts/windows-setup.mjs')
} else {
    & (Join-Path $release 'runtime/node.exe') (Join-Path $release 'app/scripts/launch.mjs') $Command
}
exit $LASTEXITCODE
