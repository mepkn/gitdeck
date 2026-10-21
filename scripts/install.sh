#!/usr/bin/env bash
# Build gitdeck.app and replace /Applications/Gitdeck.app with it, then relaunch.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/go/bin:$PATH"

wails3 task package
pkill -x gitdeck || true
rm -rf /Applications/Gitdeck.app
# Move, not copy: a second gitdeck.app in bin/ shows up in Spotlight too.
mv bin/gitdeck.app /Applications/Gitdeck.app
xattr -cr /Applications/Gitdeck.app
open /Applications/Gitdeck.app
echo "Installed /Applications/Gitdeck.app"
