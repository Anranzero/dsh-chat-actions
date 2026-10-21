#!/usr/bin/env sh
# Install dsh-chat-actions into a DSH profile.
#
#   ./install.sh                    # default profile: desktop
#   ./install.sh web                # another profile
#   ./install.sh --from-clone       # link this working copy instead of GitHub
#
# Preferred path is `dsh plugin add`, which installs through pnpm AND appends the
# bundle to `dsh.profile.bundles` (the profile layer that actually loads it).
set -eu

PROFILE=desktop
SPEC=github:Anranzero/dsh-chat-actions
FROM_CLONE=0
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"

for arg in "$@"; do
    case "$arg" in
        --from-clone) FROM_CLONE=1 ;;
        -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
        -*) echo "unknown option: $arg" >&2; exit 2 ;;
        *) PROFILE="$arg" ;;
    esac
done

if [ "$FROM_CLONE" = 1 ]; then
    HERE=$(cd "$(dirname "$0")" && pwd)
    SPEC="link:$HERE"
fi

PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
if [ ! -f "$PROFILE_DIR/package.json" ]; then
    echo "No DSH profile at $PROFILE_DIR" >&2
    echo "Start DSH once with that profile, or pass a profile name." >&2
    exit 1
fi

if [ "$FROM_CLONE" = 1 ]; then
    echo "Installing host SDK peers in the linked working copy..."
    ( cd "$HERE" && npm install --ignore-scripts --no-package-lock --no-audit --no-fund )
fi

echo "DSH home : $DSH_HOME_DIR"
echo "Profile  : $PROFILE"
echo "Spec     : $SPEC"
echo

# `dsh plugin` resolves the profile through DSH_HOME, so the resolved home must reach it too.
export DSH_HOME="$DSH_HOME_DIR"

if command -v dsh >/dev/null 2>&1; then
    dsh plugin --profile "$PROFILE" add "$SPEC"
else
    echo "dsh CLI not on PATH; falling back to a direct pnpm install." >&2
    ( cd "$PROFILE_DIR" && pnpm add "$SPEC" )
    node -e '
const fs = require("node:fs");
const path = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
const bundles = manifest.dsh.profile.bundles ?? [];
if (!bundles.includes("dsh-chat-actions")) {
    manifest.dsh.profile.bundles = [...bundles, "dsh-chat-actions"];
    fs.writeFileSync(path, JSON.stringify(manifest, undefined, 2) + "\n");
    console.log("Added dsh-chat-actions to dsh.profile.bundles.");
}
' "$PROFILE_DIR/package.json"
fi

echo
echo "Verifying the profile layer..."
if dsh --profile "$PROFILE" --dump-config 2>&1 | grep -q 'dsh-chat-actions'; then
    echo "OK: the profile loads dsh-chat-actions."
else
    echo "The profile does not list the plugin yet; restart DSH once and re-run the check."
fi

echo
echo "Restart DSH (or reopen the window) to load the plugin."
