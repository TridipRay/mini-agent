#!/bin/sh
set -eu
umask 077

bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix=${HOME:?}/.local/share/mini-agent
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = '--prefix' ] || { echo 'Usage: sh install.sh [--prefix /absolute/path]' >&2; exit 1; }
  prefix=$2
fi
case "$prefix" in /*) ;; *) echo 'Installation path must be absolute.' >&2; exit 1 ;; esac
[ -d "$bundle/payload" ] || { echo 'Use the extracted Mini Agent installer bundle.' >&2; exit 1; }
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64; checksum=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53 ;;
  Darwin-x86_64) platform=darwin-x64; checksum=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8 ;;
  Linux-aarch64|Linux-arm64) platform=linux-arm64; checksum=5ced2d48d1d7198739b7f86804de0171aefb6823b684b12341d3321afc3cb0b2 ;;
  Linux-x86_64) platform=linux-x64; checksum=1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af ;;
  *) echo 'Supported: macOS/Linux on Apple Silicon/ARM64 or x86-64. Windows: use WSL2.' >&2; exit 1 ;;
esac
for command in curl tar mktemp; do command -v "$command" >/dev/null || { echo "Required command missing: $command" >&2; exit 1; }; done
if [ -e "$prefix" ] && [ ! -f "$prefix/.mini-agent-install" ]; then
  echo "Refusing to install into an existing unmarked directory: $prefix" >&2; exit 1
fi
mkdir -p "$prefix/releases"
chmod 700 "$prefix"
touch "$prefix/.mini-agent-install"
lock="$prefix/.install-lock"
mkdir "$lock" 2>/dev/null || { echo 'An install is already running. Remove .install-lock only if that process has stopped.' >&2; exit 1; }
stage=''
cleanup() { [ -z "$stage" ] || rm -rf -- "$stage"; rmdir "$lock"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
stage=$(mktemp -d "$prefix/releases/.stage.XXXXXX")

echo 'Downloading private Node.js 22.23.3 runtime…'
archive="node-v22.23.3-$platform.tar.gz"
curl --proto '=https' --tlsv1.2 --fail --location --retry 2 --connect-timeout 20 --max-time 600 \
  "https://nodejs.org/dist/v22.23.3/$archive" -o "$stage/node.tar.gz"
if command -v shasum >/dev/null; then
  actual=$(LC_ALL=C shasum -a 256 "$stage/node.tar.gz" | cut -d ' ' -f 1)
elif command -v sha256sum >/dev/null; then
  actual=$(sha256sum "$stage/node.tar.gz" | cut -d ' ' -f 1)
else
  echo 'Required: shasum or sha256sum.' >&2; exit 1
fi
[ "$actual" = "$checksum" ] || { echo 'Node download checksum mismatch; installation stopped.' >&2; exit 1; }
mkdir "$stage/runtime"
LC_ALL=C tar -xzf "$stage/node.tar.gz" -C "$stage/runtime" --strip-components=1
rm "$stage/node.tar.gz"
cp -R "$bundle/payload" "$stage/app"
export PATH="$stage/runtime/bin:$PATH"
node "$bundle/verify.mjs" "$stage/app" "$bundle/manifest.json"
mkdir "$stage/backend"
printf '%s\n' '{"private":true,"dependencies":{"@openai/codex":"0.156.0"}}' > "$stage/backend/package.json"
echo 'Installing private official Codex backend 0.156.0…'
npm install --prefix "$stage/backend" --registry=https://registry.npmjs.org --no-audit --no-fund --cache "$stage/npm-cache"
rm -rf "$stage/npm-cache"
export MINI_AGENT_CODEX_BIN="$stage/backend/node_modules/.bin/codex"
echo 'Checking backend protocol compatibility (no sign-in or inference)…'
node "$stage/app/scripts/probe.mjs"

version=$(node -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1])).version; if (!/^\d+\.\d+\.\d+$/.test(v)) throw Error("Invalid release version"); console.log(v)' "$bundle/manifest.json")
release="$version-$(date +%Y%m%d%H%M%S)-$$"
mv "$stage" "$prefix/releases/$release"
stage=''
mkdir -p "$prefix/bin" "$prefix/data" "$prefix/workspace"
chmod 700 "$prefix/data"
cp "$bundle/mini-agent" "$prefix/bin/mini-agent"
chmod 755 "$prefix/bin/mini-agent"
# rename(2) replaces the old link atomically without following it into a directory.
"$prefix/releases/$release/runtime/bin/node" --input-type=module - "$prefix" "$release" <<'JS'
import { symlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
const [root, release] = process.argv.slice(2);
const temporary = path.join(root, `.current-${process.pid}`);
symlinkSync(path.join('releases', release), temporary);
renameSync(temporary, path.join(root, 'current'));
JS
if [ "$(uname -s)" = Darwin ]; then
  cp "$prefix/bin/mini-agent" "$prefix/bin/Launch Mini Agent.command"
  chmod 755 "$prefix/bin/Launch Mini Agent.command"
fi
printf '\nInstalled. Start with:\n  "%s/bin/mini-agent"\n\nThen choose Continue with ChatGPT in the browser.\n' "$prefix"
