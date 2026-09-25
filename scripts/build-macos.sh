#!/bin/zsh
# 碧池观鱼 · build the standalone macOS desktop-wallpaper app into dist/碧池观鱼.app,
# a universal binary (Apple silicon + Intel, macOS 12+), plus a drag-to-install disk image.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/碧池观鱼.app"
CONTENTS="$APP/Contents"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT/native/macos/Info.plist")"
DMG="$ROOT/dist/碧池观鱼-$VERSION.dmg"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

rm -rf "$APP" "$DMG"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/assets"

echo "▸ Compiling Swift wrapper…"
swiftc -O -swift-version 5 -target arm64-apple-macos12.0 -o "$WORK/BichiPond-arm64" "$ROOT/native/macos/main.swift"
# Recent SDKs no longer carry the Intel Swift runtime; add the x86_64 slice only where the toolchain can still link one.
if swiftc -O -swift-version 5 -target x86_64-apple-macos12.0 -o "$WORK/BichiPond-x86_64" "$ROOT/native/macos/main.swift" 2>/dev/null; then
  lipo -create -output "$CONTENTS/MacOS/BichiPond" "$WORK/BichiPond-arm64" "$WORK/BichiPond-x86_64"
else
  echo "  (this toolchain cannot link x86_64; building for Apple silicon only)"
  cp "$WORK/BichiPond-arm64" "$CONTENTS/MacOS/BichiPond"
fi

echo "▸ Bundling web app…"
cp "$ROOT/native/macos/Info.plist" "$CONTENTS/Info.plist"
plutil -lint -s "$CONTENTS/Info.plist"
for f in index.html app.js core.js art.js gl.js scene.js audio.js style.css; do
  cp "$ROOT/$f" "$CONTENTS/Resources/$f"
done
cp "$ROOT/assets/pond.jpg" "$ROOT/assets/pond-data.js" "$ROOT/assets/favicon.svg" "$CONTENTS/Resources/assets/"

echo "▸ Generating app icon…"
# assets/app-icon.png: 1024 px, drawn on Apple's icon grid (824 px rounded square with its own shadow).
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -s format png -z $size $size "$ROOT/assets/app-icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -s format png -z $((size * 2)) $((size * 2)) "$ROOT/assets/app-icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns -o "$CONTENTS/Resources/AppIcon.icns" "$ICONSET"

echo "▸ Signing (ad-hoc)…"
codesign --force --deep --sign - "$APP"
codesign --verify --strict "$APP"

echo "▸ Packing disk image…"
STAGE="$WORK/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/碧池观鱼.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "碧池观鱼" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG"

echo "✓ Built $APP ($(lipo -archs "$CONTENTS/MacOS/BichiPond"))"
echo "✓ Packed $DMG"
echo "  Double-click the app, and the pond becomes your desktop background."
echo "  Control it from the 🐟 item in the menu bar."
