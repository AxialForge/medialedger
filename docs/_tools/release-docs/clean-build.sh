#!/usr/bin/env bash
# Clean-machine rebuild check: exports the source at a tag into an empty folder and builds it from nothing.
#   bash docs/_tools/release-docs/clean-build.sh <tag> <work-dir> <result.json> [--installer]
# Nothing from the working tree, its node_modules or its build output is used.
set -u
TAG="$1"; WORK="$2"; RESULT="$3"; INSTALLER="${4:-}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
rm -rf "$WORK"; mkdir -p "$WORK/src"
step() { local name="$1"; shift; local t0=$(date +%s); echo "== $name: $*"; ( "$@" ) > "$WORK/$name.log" 2>&1; local code=$?; local t1=$(date +%s); echo "   exit $code in $((t1 - t0)) s"; RESULTS+=("{\"step\":\"$name\",\"command\":\"$(echo "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')\",\"exit\":$code,\"seconds\":$((t1 - t0))}"); return $code; }
RESULTS=()
git -C "$REPO" archive --format=tar "$TAG" | tar -x -C "$WORK/src"
cd "$WORK/src" || exit 1
OK=1
step install npm ci --no-audit --no-fund || OK=0
[ $OK -eq 1 ] && { step test npm test || OK=0; }
[ $OK -eq 1 ] && { step server-package node tools/pack-server.js || OK=0; }
if [ $OK -eq 1 ] && [ "$INSTALLER" = "--installer" ]; then step installer npm run build:win -- --publish never || OK=0; fi
SUITES=$(grep -c "passed" "$WORK/test.log" 2>/dev/null || echo 0)
FILES=$(ls dist 2>/dev/null | grep -E "\.exe$|\.tar\.gz$|\.sha256$|latest\.yml$|\.blockmap$" | tr '\n' ' ')
{
  echo "{"
  echo "  \"tag\": \"$TAG\", \"commit\": \"$(git -C "$REPO" rev-parse "$TAG^{commit}")\", \"when\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"node\": \"$(node -v)\", \"npm\": \"$(npm -v)\", \"os\": \"$(uname -s) $(uname -r)\","
  echo "  \"pass\": $([ $OK -eq 1 ] && echo true || echo false), \"suites_passed\": $SUITES, \"installer_built\": $([ "$INSTALLER" = "--installer" ] && [ $OK -eq 1 ] && echo true || echo false),"
  echo "  \"artifacts\": \"$FILES\","
  echo "  \"steps\": [$(IFS=,; echo "${RESULTS[*]}")]"
  echo "}"
} > "$RESULT"
cat "$RESULT"
[ $OK -eq 1 ]
