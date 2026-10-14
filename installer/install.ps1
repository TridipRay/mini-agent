param([string]$Prefix = (Join-Path $env:LOCALAPPDATA 'MiniAgent'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use install.sh on macOS/Linux.' }
$Prefix = [IO.Path]::GetFullPath($Prefix)
if ($Prefix -notmatch '^[A-Za-z]:\\') { throw 'Use an absolute local drive path.' }
$architecture = [int](Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture
switch ($architecture) {
    9 { $arch = 'x64'; $triple = 'x86_64-pc-windows-msvc'; $hash = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71' }
    12 { $arch = 'arm64'; $triple = 'aarch64-pc-windows-msvc'; $hash = '33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535' }
    default { throw 'Windows x64 or ARM64 is required.' }
}
if (!(Test-Path (Join-Path $PSScriptRoot 'payload'))) { throw 'Extract the installer ZIP first.' }
$marker = Join-Path $Prefix '.mini-agent-install'
if ((Test-Path $Prefix) -and !(Test-Path $marker)) { throw "Existing unmarked directory: $Prefix" }
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
# Windows chmod does not provide POSIX owner-only protection. Restrict the tree's ACL instead.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $Prefix /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict installation directory permissions.' }
Set-Content -LiteralPath $marker -Value 'Mini Agent' -Encoding ASCII
$lock = $null; $stage = $null
try {
    $lockPath = Join-Path $Prefix '.install-lock'
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $releases = Join-Path $Prefix 'releases'
    New-Item -ItemType Directory -Force -Path $releases | Out-Null
    $stage = Join-Path $releases ('.stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Host 'Downloading private Node.js 22.23.3 runtime...'
    $archive = Join-Path $stage 'node.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-$arch.zip" -OutFile $archive
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $hash) { throw 'Node checksum mismatch.' }
    $expanded = Join-Path $stage 'expanded'
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded
    Move-Item -LiteralPath (Join-Path $expanded "node-v22.23.3-win-$arch") -Destination (Join-Path $stage 'runtime')
    Remove-Item -LiteralPath $expanded -Recurse -Force
    Remove-Item -LiteralPath $archive -Force
    $node = Join-Path $stage 'runtime/node.exe'
    $app = Join-Path $stage 'app'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'payload') -Destination $app -Recurse
    & $node (Join-Path $PSScriptRoot 'verify.mjs') $app (Join-Path $PSScriptRoot 'manifest.json')
    if ($LASTEXITCODE -ne 0) { throw 'Application verification failed.' }
    $backend = Join-Path $stage 'backend'
    New-Item -ItemType Directory -Path $backend | Out-Null
    Copy-Item (Join-Path $app 'package.json') (Join-Path $backend 'package.json')
    Copy-Item (Join-Path $app 'package-lock.json') (Join-Path $backend 'package-lock.json')
    $env:PATH = (Join-Path $stage 'runtime') + ';' + $env:PATH
    Write-Host 'Installing private official Codex backend 0.156.0...'
    & $node (Join-Path $stage 'runtime/node_modules/npm/bin/npm-cli.js') ci --prefix $backend --registry=https://registry.npmjs.org --no-audit --no-fund --cache (Join-Path $stage 'npm-cache')
    if ($LASTEXITCODE -ne 0) { throw 'Codex installation failed.' }
    Remove-Item -LiteralPath (Join-Path $stage 'npm-cache') -Recurse -Force
    $binaryRelative = "backend/node_modules/@openai/codex-win32-$arch/vendor/$triple/bin/codex.exe"
    $env:MINI_AGENT_CLAUDE_SDK = Join-Path $backend 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'
    $env:MINI_AGENT_CODEX_BIN = Join-Path $stage $binaryRelative
    if (!(Test-Path $env:MINI_AGENT_CODEX_BIN)) { throw 'Official native Codex executable was not installed.' }
    Write-Host 'Checking backend compatibility without sign-in or inference...'
    & $node (Join-Path $app 'scripts/probe.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Backend compatibility check failed.' }
    $env:MINI_AGENT_WORKSPACE_DIR = Join-Path $Prefix 'workspace'
    New-Item -ItemType Directory -Force -Path $env:MINI_AGENT_WORKSPACE_DIR | Out-Null
    & $node (Join-Path $app 'scripts/windows-setup.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Windows sandbox setup failed. The application release was not activated.' }
    $version = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version.' }
    $release = $version + '-' + [guid]::NewGuid().ToString('N')
    Set-Content -LiteralPath (Join-Path $stage 'backend-path.txt') -Value $binaryRelative -Encoding ASCII
    Move-Item -LiteralPath $stage -Destination (Join-Path $releases $release)
    $stage = $null
    foreach ($directory in @('bin', 'data', 'workspace')) { New-Item -ItemType Directory -Force -Path (Join-Path $Prefix $directory) | Out-Null }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch.ps1') -Destination (Join-Path $Prefix 'bin/launch.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch Mini Agent.cmd') -Destination (Join-Path $Prefix 'bin/Launch Mini Agent.cmd') -Force
    # A small atomic pointer file avoids symlinks, administrator rights and Developer Mode.
    $temporary = Join-Path $Prefix ('active-' + [guid]::NewGuid().ToString('N') + '.tmp')
    Set-Content -LiteralPath $temporary -Value $release -Encoding ASCII
    $active = Join-Path $Prefix 'active-release.txt'
    if (Test-Path $active) { [IO.File]::Replace($temporary, $active, $null) } else { [IO.File]::Move($temporary, $active) }
    Write-Host "Installed. Open $Prefix\bin\Launch Mini Agent.cmd, then choose Continue with ChatGPT."
} finally {
    try {
        if ($stage -and (Test-Path $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    } finally {
        if ($lock) { $lock.Dispose(); Remove-Item -LiteralPath $lockPath -Force }
    }
}
