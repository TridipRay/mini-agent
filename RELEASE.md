# Mini Agent v0.1.0

Frozen baseline for the local ChatGPT-plan workspace agent and its standalone installers. The v0.1.0 tag identifies this baseline; new tool development belongs on a separate branch or fork.

## Included

- Browser-based ChatGPT sign-in with locally stored credentials and separate account registrations.
- Model selection, additional developer instructions, local workspace tools and explicit approval decisions.
- Streamed conversation items, interruption, account-scoped resumption and request/activity inspection.
- macOS/Linux per-user installer and native Windows x64/ARM64 installer with private Node 22.23.3 and official Codex 0.156.0 dependencies.
- Windows sandbox readiness/setup handling. Required setup may request administrator approval; failure does not activate the release or disable sandboxing.
- Credential-free installer ZIP, source archive and Git bundle for offline preservation of repository history.

## Verification and limits

The 15 automated tests cover authentication boundaries, refresh rotation, RPC lifecycle, approval handling, local HTTP boundaries, distribution exclusions and Windows sandbox setup orchestration against a process fixture. PowerShell scripts passed syntax validation using official PowerShell 7 on macOS; this is not native Windows execution.

On macOS ARM64, a clean install downloaded its private runtimes with no global Node/Codex on the command path, passed the real backend handshake, started the app, and survived reinstall with existing data preserved. In the original Mac session, the user confirmed live account sign-in, a model response and approval of a file change.

Native Windows, Linux and Intel Mac still need full installer/authentication/tool tests on those systems. OS sandbox enforcement has not been independently audited. Full assembled prompts were captured separately for a synthetic first turn during local research; those captures and local account state are not part of this product release. The UI inspector displays client requests rather than every model-visible request.

Installation requires internet access for official dependency downloads. The ZIP is not a fully offline runtime bundle, a signed MSI, or a notarized macOS app. App-server and the ChatGPT plan-usage route remain experimental upstream interfaces.

## Artifacts

- `Mini-Agent-0.1.0.zip`: installers and allowlisted runtime application files.
- `mini-agent-v0.1.0-source.zip`: tracked source at the release tag.
- `mini-agent-v0.1.0.bundle`: repository history and the release tag, restorable with `git clone`.
- `SHA256SUMS`: SHA-256 digests for the archives.

Archives exclude credentials, local chats, workspaces, downloaded runtimes, generated prompt captures and machine-specific test output. The source archive contains the build recipe and tests, while the installer contains only its runtime payload.
