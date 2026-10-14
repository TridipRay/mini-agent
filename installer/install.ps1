param([string]$Prefix = (Join-Path $env:LOCALAPPDATA 'AccountClaw'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use install.sh on macOS/Linux.' }
$Prefix = [IO.Path]::GetFullPath($Prefix)
if ($Prefix -notmatch '^[A-Za-z]:\\') { throw 'Use an absolute local drive path.' }
$architecture = [int](Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture
switch ($architecture) {
    9 { $arch = 'x64'; $triple = 'x86_64-pc-windows-msvc'; $hash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541' }
    12 { $arch = 'arm64'; $triple = 'aarch64-pc-windows-msvc'; $hash = '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921' }
    default { throw 'Windows x64 or ARM64 is required.' }
}
if (!(Test-Path (Join-Path $PSScriptRoot 'payload'))) { throw 'Extract the installer ZIP first.' }
$marker = Join-Path $Prefix '.account-claw-install'
if ((Test-Path $Prefix) -and !(Test-Path $marker)) { throw "Existing unmarked directory: $Prefix" }
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
# Windows chmod does not provide POSIX owner-only protection. Restrict the tree's ACL instead.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $Prefix /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict installation directory permissions.' }
Set-Content -LiteralPath $marker -Value 'Account Claw' -Encoding ASCII
$lock = $null; $stage = $null
try {
    $lockPath = Join-Path $Prefix '.install-lock'
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $releases = Join-Path $Prefix 'releases'
    New-Item -ItemType Directory -Force -Path $releases | Out-Null
    $stage = Join-Path $releases ('.stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Host 'Downloading private Node.js 24.21.0 runtime...'
    $archive = Join-Path $stage 'node.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-$arch.zip" -OutFile $archive
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $hash) { throw 'Node checksum mismatch.' }
    $expanded = Join-Path $stage 'expanded'
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded
    Move-Item -LiteralPath (Join-Path $expanded "node-v24.21.0-win-$arch") -Destination (Join-Path $stage 'runtime')
    Remove-Item -LiteralPath $expanded -Recurse -Force
    Remove-Item -LiteralPath $archive -Force
    $node = Join-Path $stage 'runtime/node.exe'
    $app = Join-Path $stage 'app'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'payload') -Destination $app -Recurse
    & $node (Join-Path $PSScriptRoot 'verify.mjs') $app (Join-Path $PSScriptRoot 'manifest.json')
    if ($LASTEXITCODE -ne 0) { throw 'Application verification failed.' }
    $backend = Join-Path $stage 'backend'
    New-Item -ItemType Directory -Path $backend | Out-Null
    & $node (Join-Path $app 'claw/install-manifest.mjs') (Join-Path $app 'package.json') (Join-Path $backend 'package.json')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency manifest creation failed.' }
    Copy-Item -LiteralPath (Join-Path $app 'package-lock.json') -Destination (Join-Path $backend 'package-lock.json')
    $env:PATH = (Join-Path $stage 'runtime') + ';' + $env:PATH
    Write-Host 'Installing private full OpenClaw runtime 2026.10.3...'
    & $node (Join-Path $stage 'runtime/node_modules/npm/bin/npm-cli.js') ci --prefix $backend --registry=https://registry.npmjs.org --no-audit --no-fund --cache (Join-Path $stage 'npm-cache')
    if ($LASTEXITCODE -ne 0) { throw 'OpenClaw installation failed.' }
    Remove-Item -LiteralPath (Join-Path $stage 'npm-cache') -Recurse -Force
    & $node (Join-Path $app 'claw/patch-openclaw.mjs') (Join-Path $backend 'node_modules/openclaw')
    if ($LASTEXITCODE -ne 0) { throw 'SIWC compatibility patch failed.' }
    $env:ACCOUNT_CLAW_OPENCLAW = Join-Path $backend 'node_modules/openclaw/openclaw.mjs'
    $env:ACCOUNT_CLAW_DATA_DIR = Join-Path $stage 'verification-data'
    $env:ACCOUNT_CLAW_WORKSPACE_DIR = Join-Path $stage 'verification-workspace'
    & $node (Join-Path $app 'claw/cli.mjs') doctor
    if ($LASTEXITCODE -ne 0) { throw 'OpenClaw configuration compatibility check failed.' }
    Remove-Item -LiteralPath $env:ACCOUNT_CLAW_DATA_DIR -Recurse -Force
    Remove-Item -LiteralPath $env:ACCOUNT_CLAW_WORKSPACE_DIR -Recurse -Force
    $version = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version.' }
    $release = $version + '-' + [guid]::NewGuid().ToString('N')
    Move-Item -LiteralPath $stage -Destination (Join-Path $releases $release)
    $stage = $null
    foreach ($directory in @('bin', 'data', 'workspace')) { New-Item -ItemType Directory -Force -Path (Join-Path $Prefix $directory) | Out-Null }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch.ps1') -Destination (Join-Path $Prefix 'bin/launch.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch Account Claw.cmd') -Destination (Join-Path $Prefix 'bin/Launch Account Claw.cmd') -Force
    # A small atomic pointer file avoids symlinks, administrator rights and Developer Mode.
    $temporary = Join-Path $Prefix ('active-' + [guid]::NewGuid().ToString('N') + '.tmp')
    Set-Content -LiteralPath $temporary -Value $release -Encoding ASCII
    $active = Join-Path $Prefix 'active-release.txt'
    if (Test-Path $active) { [IO.File]::Replace($temporary, $active, $null) } else { [IO.File]::Move($temporary, $active) }
    # Per-user Start Menu shortcuts need no administrator access.
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Account Claw'
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    foreach ($entry in @(@('1 - Sign in to ChatGPT', 'login'), @('1b - Sign in to Claude', 'login-claude'), @('2 - Start Account Claw', 'start'), @('3 - Open Dashboard', 'dashboard'))) {
        $shortcut = $shell.CreateShortcut((Join-Path $menu ($entry[0] + '.lnk')))
        $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Prefix 'bin/launch.ps1') + '" -Command ' + $entry[1]
        $shortcut.WorkingDirectory = $Prefix
        $shortcut.Save()
    }
    Write-Host "Installed. Open $Prefix\bin\Launch Account Claw.cmd, then run launch.ps1 -Command login to authorize ChatGPT."
} finally {
    try {
        if ($stage -and (Test-Path $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    } finally {
        if ($lock) { $lock.Dispose(); Remove-Item -LiteralPath $lockPath -Force }
    }
}
