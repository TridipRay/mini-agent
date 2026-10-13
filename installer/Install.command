#!/bin/sh
set -eu
bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$bundle/install.sh" "$@"
printf '\nPress Return to close this window. '
read -r answer
