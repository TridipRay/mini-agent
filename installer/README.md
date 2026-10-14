# Install Account Claw 0.2.0

The package sets up the full OpenClaw 2026.10.3 runtime with a private Node 24.21.0 installation and an isolated account-claw profile. It does not update an existing OpenClaw or import credentials. Internet access is required to download official runtimes and npm dependencies.

On macOS, extract the ZIP and run Install.command. On Linux, run `sh install.sh`. On Windows x64/ARM64, run Install Windows.cmd. The Windows script uses per-user ACL protection; the Unix script uses owner-only data directories. No global npm installation or shell-profile change is made. Native Windows and Linux paths require testing on those operating systems. Scripts are not signed/notarized application installers.

Default install locations:

- macOS/Linux: `~/.local/share/account-claw`
- Windows: `%LOCALAPPDATA%\AccountClaw`

First authorize ChatGPT with the installed launcher's `login` command. On macOS/Linux:

```sh
"$HOME/.local/share/account-claw/bin/account-claw" login
"$HOME/.local/share/account-claw/bin/account-claw" start
```

In a second terminal, use `account-claw dashboard` (with the same full launcher path) to open the local authenticated UI. On Windows, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\AccountClaw\bin\launch.ps1" -Command login
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\AccountClaw\bin\launch.ps1" -Command start
```

Then call the same launcher with `-Command dashboard` in another window. These launchers bypass PowerShell execution policy only for their subprocess; managed application-control policies can still block them.

The `claw` command passes remaining arguments to the complete OpenClaw CLI, including `cron`, plugins, browser, channels and memory commands. `service-install` installs a background Gateway service deliberately; keep your machine awake for scheduled jobs. It is not enabled during setup. Model account sign-in and live inference must be checked after installation. The install check validates configuration without account or model requests.

A custom absolute directory can be specified with `sh install.sh --prefix /path/account-claw` or `install.ps1 -Prefix C:\Tools\AccountClaw`. Reinstallation preserves data/workspace and retains older releases. Stop the Gateway before reinstalling. To uninstall, stop/uninstall its service if used, revoke account access, then remove the install directory. Persistent user workspaces will be deleted with that directory. Review tool permissions before running unattended tasks.
