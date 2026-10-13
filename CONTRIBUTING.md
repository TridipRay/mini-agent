# Developing from the baseline

Keep `v0.1.0` as the reproducible baseline. Use the `tool-development` branch for the next version; do not move the release tag.

```sh
git switch tool-development
npm test
npm run build:installer
```

For an isolated checkout without touching a running baseline instance:

```sh
git worktree add ../mini-agent-lab tool-development
cd ../mini-agent-lab
npm start
```

The checkout has its own ignored `.state` and workspace. Sign in separately if needed; do not copy account tokens into another checkout, repository, issue or test fixture. Source `npm start` requires Node 22.12+ and an installed Codex binary, or an explicit `MINI_AGENT_CODEX_BIN` pointing to one.

Useful directions include deliberate tool selection, editable base instructions, complete request tracing with credential redaction, stronger approval presentation, and platform validation. Preserve authentication/session boundaries when extending the agent. A developer instruction is an instruction to the model; it does not enforce tool permissions.

Add behavior tests that enter through production boundaries. Run the installer packaging test before distributing a build; its allowlist excludes account state and research captures. Never add generated directories by force. Update package version and release notes for future releases.

The archived Git bundle can be restored without a remote:

```sh
git clone mini-agent-v0.1.0.bundle mini-agent-restored
cd mini-agent-restored
git switch main
```

To make a separate repository instead of a branch, clone the baseline and change its remote. No account state travels with the tracked source.

## Publishing the prepared baseline

The intended remote is a public GitHub repository named `mini-agent`. Publishing requires the repository owner's GitHub CLI login. From the baseline checkout after `gh auth login`, create and push the repository, then attach the prepared archives:

```sh
gh repo create mini-agent --public --source . --remote origin --push
git push origin tool-development v0.1.0
gh release create v0.1.0 --verify-tag --title 'Mini Agent v0.1.0' --notes-file RELEASE.md archives/Mini-Agent-0.1.0.zip archives/mini-agent-v0.1.0-source.zip archives/mini-agent-v0.1.0.bundle archives/SHA256SUMS
```

If that repository name already exists, inspect it before choosing a remote; do not force-push an unrelated repository. The archives are prepared locally and intentionally ignored by Git. This release does not assign a new open-source license; choose one explicitly before advertising the project under a particular license.
