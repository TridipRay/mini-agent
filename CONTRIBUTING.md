# Account Claw development

This checkout is the `tool-development` branch derived from Mini Agent v0.1.0. Keep the original main branch and tag unchanged. Account Claw's entry point is `claw/cli.mjs`; retained Mini Agent modules are reference code and tested baseline components.

Use Node 24.16+ within major 24, or Node 26.1+. The pinned installer supplies Node 24.21.0. Install the locked OpenClaw dependency with `npm ci`, then run:

```sh
npm test
npm run setup
npm run login
npm start
```

The account login requires interactive browser consent and an eligible ChatGPT account. No API key is requested. Use the local dashboard after starting the gateway; all OpenClaw commands are accessible through `npm run claw -- <arguments>`. Do not copy Mini Agent credentials or the default OpenClaw state into this checkout.

Tests exercise our configuration, launcher command selection, distribution boundaries and retained Mini Agent components. Test the real gateway and installer before claiming those paths work. Do not describe process fixtures as platform execution or a scheduler command test as successful model inference. Account Claw uses OpenClaw's approval/runtime boundaries; Codex sandbox setup tests refer to the retained baseline and do not establish this new runtime's OS enforcement.

The installer build uses an explicit file allowlist and dependency lockfile. Never force-add generated state, workspaces, runtimes or logs. Keep the OpenClaw license and its dependency notices intact. Default recurring maintenance remains opt-in. Changes to autonomous execution, service installation or remote access need concrete behavior validation.

Use ACCOUNT-CLAW-RELEASE.md for this branch's validation record; RELEASE.md documents the archived Mini Agent baseline. Add a new version/tag only when its tested scope and remaining limitations are recorded.
