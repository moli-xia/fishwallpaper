#!/bin/zsh
# 碧池观鱼 · publish to GitHub: create the public repository (if needed), push, and release every app.
# Needs the GitHub CLI signed in to the owning account:  gh auth login
# Builds are taken from dist/ (run the scripts/build-*.sh first), renamed to plain ASCII for the release.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${REPO:-moli-xia/fishwallpaper}"
VERSION="${VERSION:-1.2.0}"
GH="${GH:-$(command -v gh || true)}"
[[ -n "$GH" ]] || { echo "GitHub CLI not found: https://cli.github.com (or set GH=/path/to/gh)"; exit 1; }
"$GH" auth status >/dev/null 2>&1 || { echo "Sign in first:  gh auth login"; exit 1; }
cd "$ROOT"

echo "▸ Collecting the apps…"
OUT="$ROOT/build/release"; rm -rf "$OUT"; mkdir -p "$OUT"
cp "dist/碧池观鱼-$VERSION.dmg" "$OUT/BichiKoiPond-$VERSION-macOS.dmg"
cp "dist/碧池观鱼-Windows-$VERSION.zip" "$OUT/BichiKoiPond-$VERSION-Windows.zip"
cp "dist/碧池观鱼.apk" "$OUT/BichiKoiPond-$VERSION-Android.apk"
(cd dist && zip -qr -X "$OUT/BichiKoiPond-$VERSION-Web.zip" index.html style.css core.js art.js gl.js scene.js audio.js app.js project.json assets -x '*.DS_Store')
(cd "$OUT" && shasum -a 256 BichiKoiPond-* > SHA256SUMS.txt)

echo "▸ Repository $REPO…"
if ! "$GH" repo view "$REPO" >/dev/null 2>&1; then
  "$GH" repo create "$REPO" --public --description "碧池观鱼 · 锦鲤池塘动态壁纸（macOS / Windows / Android / Web）"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
"$GH" auth setup-git
git push -u origin HEAD:main

echo "▸ Release v$VERSION…"
NOTES="docs/release-notes-$VERSION.md"
if "$GH" release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  "$GH" release upload "v$VERSION" "$OUT"/* --repo "$REPO" --clobber
else
  "$GH" release create "v$VERSION" "$OUT"/* --repo "$REPO" --title "碧池观鱼 v$VERSION" --notes-file "$NOTES"
fi
echo "✓ https://github.com/$REPO/releases/tag/v$VERSION"
