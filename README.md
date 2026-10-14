# Account Claw

An account-backed local assistant distribution built from Mini Agent's v0.1.0 baseline and the full OpenClaw 2026.10.3 runtime. ChatGPT sign-in authorizes eligible model calls using your account allowance, without entering an OpenAI API key. OpenClaw supplies its agent loop, tools, browser/desktop integrations, sessions, memory, plugins, channels and persistent cron scheduler.

This is an integration distribution, not a reimplementation of every OpenClaw subsystem. The initial account route is OpenClaw's official SIWC method using public Responses API calls. Each user signs in and authorizes their own account; Mini Agent's credentials and the existing machine's OpenClaw profiles are not copied.

## Claude subscription support

Version 0.2.2 adds dashboard Claude subscription sign-in under **Settings → Models → Connect provider → Anthropic → Claude subscription (Claude Code)**. Follow the browser link, authorize your subscribed Claude account, and paste the authorization code into the masked dashboard field if prompted. When connected, select a Claude model in the Model dropdown; connection and model selection are separate. You can also reuse an already signed-in native Claude account through the confirmation step.

Version 0.2.1 added a private Claude Code 2.1.299 runtime. Use `account-claw login-claude` (or the Sign in to Claude launcher) to complete Claude Code's browser sign-in and select the native Claude backend. `account-claw claude-status` checks the account. OpenClaw delegates to Claude Code; it does not copy or forward the native login tokens. Your ChatGPT login stays available: use the dashboard model selector, or `account-claw claw models set openai/gpt-6.1-sol`, to switch back. Claude sessions use the `claude-cli` provider. Cron jobs can select an explicit Claude model using OpenClaw's `--model` option.

The Claude login is isolated in the installation's `data/claude` directory. Reinstallation keeps it. Existing gateways must be restarted to pick up the new private runtime and environment. Model API keys, alternate Anthropic endpoints and cloud-provider environment switches are removed from child processes so this account route cannot silently fall back to API billing.

Anthropic's [current plan support](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) describes subscription usage for CLI/SDK/third-party apps. This is native Claude Code delegation, not a custom Claude OAuth implementation. Account entitlements, limits, and optional integration credentials still apply. See [OpenClaw's Claude backend](https://docs.openclaw.ai/providers/anthropic).

## Install and first use

Download the macOS, Linux, or Windows ZIP from [Account Claw releases](https://github.com/TridipRay/mini-agent/releases/tag/account-claw-v0.2.2). See the [installer guide](installer/README.md) for launch shortcuts. Extract the Account-Claw installer ZIP and run `Install.command` on macOS, `sh install.sh` on Linux, or `Install Windows.cmd` on native Windows. The installer downloads private Node 24.21.0 and pinned OpenClaw dependencies. No existing desktop app or global OpenClaw update is required.

On macOS/Linux:

```sh
"$HOME/.local/share/account-claw/bin/account-claw" login
"$HOME/.local/share/account-claw/bin/account-claw" start
```

In another Terminal, open the authenticated dashboard:

```sh
"$HOME/.local/share/account-claw/bin/account-claw" dashboard
```

On Windows, run `launch.ps1 -Command login` in the installed `%LOCALAPPDATA%\AccountClaw\bin` directory, then use `Launch Account Claw.cmd` and `launch.ps1 -Command dashboard`. Keep the gateway terminal open. `service-install` installs OpenClaw's account-claw background service when you deliberately want always-on operation; it is not installed automatically.

For this development checkout with its private Node runtime:

```sh
.runtime/bin/node claw/cli.mjs login
.runtime/bin/node claw/cli.mjs start
.runtime/bin/node claw/cli.mjs dashboard
```

The dashboard normally runs on `http://127.0.0.1:18889`. Use the dashboard command to attach its automatically generated local Gateway authentication token. That token is local access control, not an OpenAI API key, and is not sent as the model credential.

## Scheduling

All OpenClaw commands are available through `account-claw claw ...`. Jobs persist in the isolated profile; the Gateway must be running and the machine awake for execution. Set the job's timezone explicitly for wall-clock schedules. For example:

```sh
account-claw claw cron add --name daily-project-review --cron '0 9 * * 1-5' --tz America/New_York --session isolated --message 'Review the workspace and report what needs attention. Do not modify files.' --no-deliver
account-claw claw cron list
account-claw claw cron runs JOB_ID
account-claw claw cron disable JOB_ID
```

Replace `account-claw` above with your installed launcher's full path if it is not on PATH. The tools can also manage schedules from conversation, subject to OpenClaw's policy. Review command jobs carefully: an explicit command payload authorizes its specified local process independently of a model turn. The installer creates no user command or recurring agent job. Development validation used disposable one-shot jobs.

Initial defaults ask before host command execution, restrict file tools to the chosen workspace, and keep heartbeat, autonomous skill review and memory dreaming off. Enable recurring behavior deliberately. These are OpenClaw controls, not Codex's OS sandbox. Configure OpenClaw sandboxing, tool policies and approvals according to your intended access. Desktop automation additionally needs OS permissions and platform helpers. The full runtime exposes these integrations; they have not all been exercised in this build.

## Account and capability boundaries

The selected SIWC profile uses eligible Responses models and shares ChatGPT plan allowance. Eligibility and workspace consent determine available models; an arbitrary account or plan is not guaranteed access. Token refresh is managed by OpenClaw, and a revoked grant or exhausted quota can make a scheduled model job fail. Model errors are not silently redirected to an inherited API key.

ChatGPT model authorization does not authenticate Telegram, Slack, email or other services. Connect those services separately if desired. SIWC does not itself grant OpenAI image generation, transcription, realtime voice, hosted connectors or embedding access. Local plugins and alternatives can cover some of those features; account access alone does not make every OpenClaw integration usable. Memory search defaults to local embeddings with no paid-provider fallback; first use may download a local embedding model.

The optional `login-codex` command uses OpenClaw's documented Codex browser OAuth method, also without an API key. It replaces the selected `chatgpt-account` profile with that account route. Some account capabilities differ from SIWC; availability still depends on account access and separate service permissions. Neither route provides unrestricted access to every OpenAI API. Use one selected route deliberately rather than importing another application's token store.

## Isolation and development

Configuration, accounts, sessions and jobs live under `.state/openclaw` in a checkout, or the installed `data/openclaw` directory. The workspace is separate. Existing Mini Agent and `~/.openclaw` state are not imported. Inherited API-key/token environment variables are removed before launching the account-backed runtime. Channel credentials retain their independent configuration and are not implicitly connected.

Environment settings: `ACCOUNT_CLAW_DATA_DIR`, `ACCOUNT_CLAW_WORKSPACE_DIR`, `ACCOUNT_CLAW_PORT`, and `ACCOUNT_CLAW_OPENCLAW` (an explicit OpenClaw entry-point path). Full CLI access can deliberately change this configuration; the default account policy is not a security boundary against the local owner.

A guarded, version-specific SIWC compatibility patch aligns the pinned release with the documented IPv4 callback and stable host identifier requirements. `npm ci` applies it through postinstall; the standalone installer also applies it explicitly. It modifies only this distribution's dependency, not a global OpenClaw installation. Unknown upstream bytes cause a failure rather than an unreviewed patch. See ACCOUNT-CLAW-RELEASE.md for legacy-registration considerations and validation evidence.

Run `npm test` and `npm run build:installer` with a supported Node version. Original Mini Agent files remain in the branch as the baseline/reference implementation; Account Claw's entry point is `claw/cli.mjs` and its dashboard is OpenClaw's UI. Credentials, downloaded dependencies, workspace contents and machine-specific artifacts are ignored. The main branch and v0.1.0 tag preserve the original product.

## References

- [OpenClaw account authentication and capability matrix](https://docs.openclaw.ai/providers/openai/authentication)
- [OpenClaw scheduler](https://docs.openclaw.ai/automation/cron-jobs)
- [Official local ChatGPT plan inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md)
- Pinned upstream source: `openclaw/openclaw`, tag `v2026.10.3`, commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`. OpenClaw is MIT-licensed; its package carries its own license and third-party notices.
