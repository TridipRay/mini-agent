# Mini Agent — ChatGPT and Claude development version

Version 0.1.1 adds Claude subscription support alongside ChatGPT. The frozen Mini Agent v0.1.0 release remains unchanged; this code is on `mini-agent-development`.

Select **Claude** in the Provider selector, then **Continue with Claude**. Claude Code opens its own browser sign-in and owns credential storage and refresh. After authorization, choose a model and workspace, and start a conversation. You can also use the installed launcher's `claude-login` command, then **Refresh Claude sign-in status** in the UI. `claude-status` checks the current login. Sign in with a subscription account, rather than an Anthropic Console account.

The Claude runtime and Agent SDK are privately installed and pinned. Login state is isolated in `data/claude` (or `.state/claude` in the development checkout). Claude conversations are stored separately and bound to the native account identity. ChatGPT sign-in and Codex conversations stay available when switching providers. Claude's native permission requests and questions appear in the existing approval UI; project/user settings are not automatically imported into this SDK host.

Claude uses its own tool permission engine. Its permission checks are not Codex's OS sandbox. This version keeps manual approvals for Claude changes and shell commands; the Codex workspace-write selector does not apply to Claude. Inherited Anthropic API keys, token overrides, alternate endpoints and cloud-provider switches are removed from the Claude process environment.

Anthropic's [current subscription support](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) includes SDK, headless CLI and third-party usage. Native Claude delegation is used here; the app implements no custom Claude OAuth flow. Account limits and entitlements apply. Live Claude inference still requires the user to sign in and test the selected account.

Development setup: `npm ci`, then `npm start`. The dual-provider installer includes private Codex and Claude runtimes; use the same per-platform install steps below.

---

# Mini Agent

A stripped-down local agent client: ChatGPT account sign-in, workspace selection, streamed responses, additional instructions, file/tool activity, explicit approval prompts, stop, conversation resumption, and a request inspector. No npm dependencies are needed.

Version **0.1.0** is the frozen product baseline. See [RELEASE.md](RELEASE.md) for its scope and verified platforms, and [CONTRIBUTING.md](CONTRIBUTING.md) for developing a separate version from this baseline.

This client uses OpenAI's documented **Sign in with ChatGPT plan-usage flow** and the installed Codex **app-server**. It does not copy desktop app code, read its authentication store, scrape browser cookies, or use ChatGPT's private backend-api endpoints.

## Run

For machines without Node.js or Codex, use the [standalone installer](installer/README.md). Build the credential-free distribution with `npm run build:installer`; the resulting ZIP is written to `dist/`. Its installer downloads private pinned runtimes, checks the backend handshake, and creates a launcher. It does not depend on the source desktop application.

Requires Node.js 22.12+ and an installed Codex binary. On this Mac, the default is `/Applications/ChatGPT.app/Contents/Resources/codex`.

```bash
cd mini-agent
npm start
```

Open the printed `http://127.0.0.1:PORT` address. Then:

1. Choose **Continue with ChatGPT**. The system browser goes to OpenAI for account sign-in, agent registration and consent to use your plan. This first-time local/open-source registration uses `dynamic_agent_client`; no API key, partner key or client secret is needed.
2. After the callback, pick a model from your account's catalog. Listing is not proof that a generation will be admitted; a completed turn is the actual check.
3. Enter an existing workspace directory. Start with **Read-only** or deliberately select workspace write. Requests use `approvalPolicy: on-request`, `approvalsReviewer: user`; backend policy controls which operations require approval. Workspace write permits edits in the workspace without asking for each edit.
4. Add optional instructions and start a conversation. Send prompts and review approval cards. Command/file approvals offered here are one-time; additional permission grants are scoped to the current turn.
5. **Stop turn** sends `turn/interrupt`. Failed/interrupted/unknown outcomes are shown separately from a completed response.

The workspace is the agent's working directory, not a promise that read-only mode can read only that directory. Codex's actual sandbox, managed requirements and deny-read rules still apply.

For a first live check, ask a harmless question. Then ask it to read a file from the chosen workspace. Finally, while in read-only mode, request creation of a small disposable file and confirm that the relevant approval appears before permitting the change. Complete those steps yourself in the UI; automated tests did not use your account or consume plan usage.

## What it reproduces

```text
Local window → our JSONL client → official Codex app-server
             → public Responses API → streamed agent events
```

The backend is still Codex. It provides agent orchestration, local tools, history and sandbox policy. Our client supplies the UI, authenticates its own ChatGPT account registration and passes the authorized OAuth access token in the child environment. It identifies itself as `mini_agent` instead of impersonating a first-party client.

The model picker uses the account-specific public model catalog. Token renewal is serialized and refresh-token rotation is saved atomically. Before the next turn, a renewed token starts a fresh app-server and resumes the saved thread. An expired credential during an already running turn can still cause a failure; the client does not silently replay that mutation.

Visible conversation items are cached locally for restoration; backend conversation state is resumed by thread ID. This client lists only conversations it created for the selected account. It does not import your ChatGPT web conversations, memories, projects, or source application's existing chats.

## Prompt control and deeper observation

**Additional instructions** are passed as `developerInstructions` when a new thread starts. Codex also assembles its own instructions, AGENTS guidance, tool definitions, history and environment context. Changing the text box applies to a new conversation; it does not secretly replace the instructions of the current one.

The request inspector shows our concrete `thread/start`, `thread/resume`, and `turn/start` parameters plus returned instruction-source paths. This is the **client request**, not a dump of the complete model-visible prompt or hidden reasoning. The activity panel shows public app-server events, including commands/file changes and completed/interrupted/failed turn status.

This turns several prior static-analysis uncertainties into testable questions:

- Authentication/model eligibility: browser consent, account catalog and a completed turn.
- Actual runtime behavior: observe the streamed item/turn events for your own new conversation.
- Approval behavior: use a disposable workspace and review requested decisions.
- Sandbox behavior: exercise a bounded read/write scenario and inspect the resulting command/file events. Full OS-enforcement testing still requires independent observation, not just a successful UI request.
- Complete prompt assembly: trace the official open-source Codex prompt builder, or use the version's supported `codex debug prompt-input` tooling on a controlled scenario. The exact desktop feature mix will still differ.

## Account and storage boundaries

`.state/` is gitignored, mode 0700; account and transcript JSON files are atomically written with mode 0600. OAuth access/refresh/ID tokens stay in the local process/storage, never in browser storage or UI event logs. Sign-out attempts remote refresh-token revocation, clears local tokens and retains the registration/host identity. If remote revocation fails, the UI says so and points you to ChatGPT Settings.

Sign-in uses state, nonce and PKCE, checks the issued client ID, verifies the ID token's RS256 signature against published JWKS, validates issuer/audience/expiration/nonce/subject, and checks ChatGPT-plan scopes before activation. Multiple account/workspace registrations remain separate. Only the local owner should run/access this service; it is a localhost development client, not a remotely hosted service or a hardened multi-user desktop product.

The app binds only to `127.0.0.1`, checks Host/Origin/browser request context and its HTTP-only session cookie, and exposes explicit operations rather than arbitrary backend RPC. Browser text is rendered with textContent. The app-server uses your normal Codex runtime/configuration; configured local MCP servers or trusted hooks can affect a turn. This version disables app/plugin integration and web search in its process configuration, but does not rewrite your global config or claim to isolate every user-configured extension.

Optional environment settings:

```text
MINI_AGENT_CODEX_BIN=/absolute/path/to/codex
MINI_AGENT_DATA_DIR=/absolute/private/data/directory
MINI_AGENT_PORT=5511
```

## Plan usage and current limitations

Official docs permit this flow for local/open-source applications. The current preview requires `store:false`, `stream:true` over HTTP; the documented Codex provider configuration selects HTTP/SSE and supplies those fields. ChatGPT Plus usage is shared across apps using the plan; this client does not create a separate allowance. Credits/limits follow your ChatGPT consent and settings. [Plan usage and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions.md)

The route is not feature-equivalent to the desktop application: hosted connectors/MCP, native computer use, image generation, Code Interpreter and file search are unavailable through this plan-usage preview. Local shell and local MCP/function tools are a separate Codex capability. The preview rejects Responses `tool_search`; a user configuration that emits it can fail and requires a compatible configuration. MCP elicitation is currently declined by this UI rather than presenting arbitrary connector forms. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations.md)

App-server and its protocol are experimental. The v0.1.0 product baseline has a working local client and distributable installer. It is not a complete source-application clone; native Windows and Linux still require end-to-end validation on those operating systems.

## Verification

```bash
npm test
npm run probe
```

Tests cover public production paths for dynamic OAuth registration/ID-token validation, rejected/replayed/expired callbacks, absent plan permission, credential file modes, serialized refresh rotation, actual stdio framing, completion-before-response, waiting approvals, account-scoped resumption, process death and loopback HTTP request boundaries. Fixtures simulate OpenAI and the upstream agent; they do not establish account access or successful inference.

The live probe uses the actual installed binary and provider flags, performs `initialize`/`initialized`, then closes its owned process. It never requests account data, creates a thread, lists models or performs inference. `test-artifacts/live-probe.json` records the result locally and is excluded from distributions. On the original Mac, the user confirmed account sign-in, a live response and approval of a completed file-change operation. The standalone installer also passed clean install, startup, metadata checks and reinstall with persistent data preserved on macOS ARM64. Those observations do not establish end-to-end behavior on other machines.

## Official implementation references

- [Sign in and dynamic registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)
- [Codex app-server with ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md)
- [App-server protocol and events](https://learn.chatgpt.com/docs/app-server)
