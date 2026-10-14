# Claude support in Mini Agent 0.1.1

This installer includes both private Codex and Claude Agent SDK runtimes. After launch, select **ChatGPT** or **Claude** in the Provider selector. **Continue with Claude** launches Claude Code's own subscription sign-in. Complete the browser flow yourself, then choose a model and workspace. No Anthropic API key is needed for this route.

The installed launcher also accepts `claude-login` and `claude-status` commands (on Windows, `launch.ps1 -Command claude-login`). Claude login and conversations are kept separately from ChatGPT. Native Claude permission requests are shown in the UI; Codex's OS sandbox does not apply to Claude. The existing frozen Mini Agent release is unaffected.

# Install Mini Agent

This package installs a local browser interface with ChatGPT sign-in, Codex file/tools access, streamed conversations and approval prompts. You do not need Node.js, Codex, the ChatGPT desktop app, an API key or a source checkout already installed.

## macOS

1. Extract the ZIP.
2. Double-click **Install.command**, or open Terminal and run `sh /path/to/Mini-Agent-0.1.0/install.sh`.
3. Launch by double-clicking `~/.local/share/mini-agent/bin/Launch Mini Agent.command` in Finder (Go → Go to Folder), or run:

```sh
"$HOME/.local/share/mini-agent/bin/mini-agent"
```

If macOS blocks the downloaded script, use the Terminal command after reviewing it. This is a script-based installer, not a signed/notarized macOS application.

## Native Windows

1. Extract the ZIP to a folder on Windows 10/11 x64 or ARM64.
2. Double-click **Install Windows.cmd**.
3. Launch `%LOCALAPPDATA%\MiniAgent\bin\Launch Mini Agent.cmd`.
4. Choose **Continue with ChatGPT** in the browser.

No WSL2, Node or Codex installation is needed. Installing the application is per-user. The installer also checks Windows sandbox readiness and starts Codex's elevated setup when needed; Windows may request administrator approval for that step. A failed setup prevents release activation rather than disabling sandboxing. This path does not silently select the weaker unelevated fallback. Managed machines may require IT provisioning. See the [official Windows sandbox guide](https://learn.chatgpt.com/docs/windows/windows-sandbox).

The installer uses Windows PowerShell, downloads the private Windows runtimes, and restricts the installation directory's inherited ACL to your account and Windows SYSTEM. It invokes the native Codex `.exe` directly rather than a shell wrapper. An atomic release-pointer file supports reinstalls without requiring symlink privileges. Codex's documented sandbox setup may provision sandbox users, firewall/ACL rules and its sandbox configuration; no account credentials are reused or imported.

The CMD launchers apply ExecutionPolicy Bypass only to their PowerShell subprocess; no machine/user policy is changed. Managed application-control or script policies can still block execution. These are scripts, not a signed MSI. For a custom local drive path, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Prefix 'D:\Tools\MiniAgent'
```

For the installed metadata check:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MiniAgent\bin\launch.ps1" -Command doctor
```

## Linux / optional Windows WSL2

Extract the ZIP, then run:

```sh
sh /path/to/Mini-Agent-0.1.0/install.sh
"$HOME/.local/share/mini-agent/bin/mini-agent"
```

Supported architectures: macOS Apple Silicon/Intel, Linux ARM64/x86-64. Linux requires a glibc distribution supported by the official Node/Codex releases; Alpine/musl is not supported by this installer. Windows can alternatively use this path in WSL2 with a browser able to reach the printed localhost URL. WSL2 is not installed by this package. Installation needs HTTPS internet access to nodejs.org and registry.npmjs.org; the Unix installer requires standard curl, tar and a SHA-256 utility. The launcher attempts to open a browser; if that fails, open the printed address manually.

## First use

The launcher opens the localhost app. Choose **Continue with ChatGPT**, complete sign-in and plan-usage consent, choose a model, then start a conversation. Each machine registers separately. Accounts and tokens are never included in the installer. Your plan allowance is shared; installation creates no extra subscription capacity.

The initial workspace is a disposable directory inside the install root. Read-only is the UI default. Point the app at an existing project when ready. Optional additional instructions customize the agent's developer instructions; this release does not expose base-prompt replacement in its UI.

Keep the launcher terminal open while using the app. Press Control-C there to stop it. There is no background service or automatic start at login.

## What installation does

Everything is placed under `~/.local/share/mini-agent` on macOS/Linux or `%LOCALAPPDATA%\MiniAgent` on native Windows: a private Node.js 22.23.3 runtime, official npm Codex 0.156.0, application releases, `bin` launchers, `data` account/conversation metadata and a persistent `workspace`. Node archives are checked against pinned official SHA-256 hashes; npm verifies downloaded package integrity. The app files are checked against the bundle manifest. No sudo, global package install, shell-profile edit or desktop-app dependency is used.

Before activating a release, the installer initializes its Codex app-server and closes it. This checks protocol compatibility without OAuth or inference. Failures leave an existing active release untouched. Installation can be repeated to update application files while retaining `data` and `workspace`; stop Mini Agent first. Older releases are retained. The backend continues to use normal Codex configuration, including any locally configured MCP tools and managed policies.

You can select an absolute custom location:

```sh
sh install.sh --prefix /absolute/path/mini-agent
```

The installer rejects an existing directory it did not create. A leftover `.install-lock` after a killed installer can be removed only after confirming no installer is still running.

Run the installed metadata check:

```sh
"$HOME/.local/share/mini-agent/bin/mini-agent" doctor
```

To uninstall, stop the app, sign out in its UI to attempt token revocation, then remove the install directory. Removing it deletes Mini Agent's local account records and workspace. Codex may retain its own history/configuration separately; these are not deleted. You can revoke plan access in ChatGPT Settings → Usage.

## Verification limits

The clean installation, startup and reinstall tests ran on macOS ARM64. Linux, Intel Mac and native Windows installers still need full execution on those actual machines. Windows release availability and pinned Node checksums were checked; this does not establish Windows runtime behavior. A successful installation check does not establish account eligibility, live inference or OS sandbox enforcement. These require a live session on the target machine.

Official references: [Codex installation](https://developers.openai.com/codex/cli), [Node downloads](https://nodejs.org/en/download), [local ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md).
