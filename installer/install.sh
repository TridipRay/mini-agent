#!/bin/sh
set -eu
umask 077

bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix=${HOME:?}/.local/share/account-claw
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = '--prefix' ] || { echo 'Usage: sh install.sh [--prefix /absolute/path]' >&2; exit 1; }
  prefix=$2
fi
case "$prefix" in /*) ;; *) echo 'Installation path must be absolute.' >&2; exit 1 ;; esac
[ -d "$bundle/payload" ] || { echo 'Use the extracted Account Claw installer bundle.' >&2; exit 1; }
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64; checksum=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 ;;
  Darwin-x86_64) platform=darwin-x64; checksum=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097 ;;
  Linux-aarch64|Linux-arm64) platform=linux-arm64; checksum=724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5 ;;
  Linux-x86_64) platform=linux-x64; checksum=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff ;;
  *) echo 'Supported: macOS/Linux on Apple Silicon/ARM64 or x86-64. Windows: use Install Windows.cmd.' >&2; exit 1 ;;
esac
for command in curl tar mktemp; do command -v "$command" >/dev/null || { echo "Required command missing: $command" >&2; exit 1; }; done
if [ -e "$prefix" ] && [ ! -f "$prefix/.account-claw-install" ]; then
  echo "Refusing to install into an existing unmarked directory: $prefix" >&2; exit 1
fi
mkdir -p "$prefix/releases"
chmod 700 "$prefix"
touch "$prefix/.account-claw-install"
lock="$prefix/.install-lock"
mkdir "$lock" 2>/dev/null || { echo 'An install is already running. Remove .install-lock only if that process has stopped.' >&2; exit 1; }
stage=''
cleanup() { [ -z "$stage" ] || rm -rf -- "$stage"; rmdir "$lock"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
stage=$(mktemp -d "$prefix/releases/.stage.XXXXXX")

echo 'Downloading private Node.js 24.21.0 runtime…'
archive="node-v24.21.0-$platform.tar.gz"
curl --proto '=https' --tlsv1.2 --fail --location --retry 2 --connect-timeout 20 --max-time 600 \
  "https://nodejs.org/dist/v24.21.0/$archive" -o "$stage/node.tar.gz"
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
node "$stage/app/claw/install-manifest.mjs" "$stage/app/package.json" "$stage/backend/package.json"
cp "$stage/app/package-lock.json" "$stage/backend/package-lock.json"
echo 'Installing private full OpenClaw runtime 2026.10.3…'
npm ci --prefix "$stage/backend" --registry=https://registry.npmjs.org --no-audit --no-fund --cache "$stage/npm-cache"
rm -rf "$stage/npm-cache"
node "$stage/app/claw/patch-openclaw.mjs" "$stage/backend/node_modules/openclaw"
export ACCOUNT_CLAW_OPENCLAW="$stage/backend/node_modules/openclaw/openclaw.mjs"
export ACCOUNT_CLAW_DATA_DIR="$stage/verification-data"
export ACCOUNT_CLAW_WORKSPACE_DIR="$stage/verification-workspace"
echo 'Checking backend protocol compatibility (no sign-in or inference)…'
node "$stage/app/claw/cli.mjs" doctor
rm -rf "$stage/verification-data" "$stage/verification-workspace"

version=$(node -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1])).version; if (!/^\d+\.\d+\.\d+$/.test(v)) throw Error("Invalid release version"); console.log(v)' "$bundle/manifest.json")
release="$version-$(date +%Y%m%d%H%M%S)-$$"
mv "$stage" "$prefix/releases/$release"
stage=''
mkdir -p "$prefix/bin" "$prefix/data" "$prefix/workspace"
chmod 700 "$prefix/data"
cp "$bundle/account-claw" "$prefix/bin/account-claw"
chmod 755 "$prefix/bin/account-claw"
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
  cp "$prefix/bin/account-claw" "$prefix/bin/Launch Account Claw.command"
  chmod 755 "$prefix/bin/Launch Account Claw.command"
  for name in 'Sign in to ChatGPT.command' 'Sign in to Claude.command' 'Open Dashboard.command'; do
    cp "$prefix/bin/account-claw" "$prefix/bin/$name"
    chmod 755 "$prefix/bin/$name"
  done
  echo "Finder launchers: $prefix/bin (Sign in, Launch, Open Dashboard)."
fi
printf '\nInstalled. Start with:\n  "%s/bin/account-claw"\n\nRun the launcher with login to authorize ChatGPT, then start and dashboard.\n' "$prefix"
