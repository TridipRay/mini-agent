# Install Account Claw

Download the ZIP for your operating system and extract it before running the installer. Internet access is required. Node.js and OpenClaw are installed privately; no API key or administrator login is needed.

| Platform | Install | Sign in and launch |
| --- | --- | --- |
| macOS (Apple Silicon / Intel) | Double-click `Install.command` | Open `~/.local/share/account-claw/bin` in Finder. Run **Sign in to ChatGPT.command**, then **Launch Account Claw.command**, then **Open Dashboard.command**. |
| Linux (ARM64 / x64) | Run `sh install.sh` in the extracted folder | Use the commands below. |
| Windows (ARM64 / x64) | Double-click `Install Windows.cmd` | Open **Account Claw** in the Start menu. Run shortcuts **1**, **2**, then **3**. |

Linux commands (open a second terminal for the dashboard):

```sh
"$HOME/.local/share/account-claw/bin/account-claw" login
"$HOME/.local/share/account-claw/bin/account-claw" start
# In a second terminal:
"$HOME/.local/share/account-claw/bin/account-claw" dashboard
```

To use Claude instead, choose **Sign in to Claude.command** on macOS or **1b - Sign in to Claude** in the Windows Start Menu. On Linux run the installed launcher with `login-claude`. This uses the private Claude Code runtime and then selects OpenClaw's native Claude backend. Your ChatGPT login is retained; switch models in the dashboard. `claude-status` checks the Claude login. Stop and restart an existing gateway after upgrading to this release.

Sign-in opens an authorization page where you choose your ChatGPT account. Keep the gateway terminal open while using the tool or running scheduled jobs. On later launches, skip sign-in unless the account needs reconnection. The dashboard uses your default browser.

The private runtime is OpenClaw 2026.10.3 and Node.js 24.21.0. Existing OpenClaw installations and credentials are kept separate. Default installation directories are `~/.local/share/account-claw` (macOS/Linux) and `%LOCALAPPDATA%\AccountClaw` (Windows). The universal ZIP contains installers for all platforms.

These are script installers, not signed/notarized app bundles. If macOS or your organization's Windows policy blocks a script, review it and follow your machine's normal approval process. Windows shortcuts bypass PowerShell execution policy for that subprocess only; they do not override managed application-control policies.

For a custom location, run `sh install.sh --prefix /absolute/path` or `install.ps1 -Prefix C:\Tools\AccountClaw`. Stop the gateway before reinstalling. Reinstallation preserves data and workspace and retains previous releases.

Advanced CLI commands use the launcher followed by `claw`, e.g. `account-claw claw cron list`. `service-install` deliberately installs a background gateway service; it is not enabled during installation. Scheduled jobs require a running gateway and an awake machine. Review permissions before unattended tasks.

To uninstall, stop the gateway and uninstall its service if enabled, revoke account access, and remove the installation directory. This also deletes its stored conversations and workspace. Remove the Windows Start Menu folder separately.
