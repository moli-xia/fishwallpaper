#!/bin/zsh
# 碧池观鱼 · build the Android live-wallpaper APK into android/build/碧池观鱼.apk (copied to dist/ as well)
# Requires a one-time toolchain under ~/android-build (override with ANDROID_BUILD env):
#   dl/jdk.tar.gz        Temurin JDK 17 (macOS aarch64)   → jdk/
#   dl/build-tools.zip   https://dl.google.com/android/repository/build-tools_r34-macosx.zip → bt/
#   dl/platform-34.zip   https://dl.google.com/android/repository/platform-34-ext7_r03.zip   → plat/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="${ANDROID_BUILD:-$HOME/android-build}"
JAVA_HOME="$SDK_ROOT/jdk/Contents/Home"
BT="$SDK_ROOT/bt/android-14"
AJ="$SDK_ROOT/plat/android-34/android.jar"
VERSION_NAME="1.2.0"
VERSION_CODE=3
export PATH="$JAVA_HOME/bin:$PATH"
cd "$ROOT/android"

# Package the current pond, never a stale copy: assets/ is rebuilt from the web sources every time.
rm -rf assets && mkdir -p assets/assets
for f in index.html app.js core.js art.js gl.js scene.js audio.js style.css; do cp "$ROOT/$f" assets/; done
cp "$ROOT/assets/pond.jpg" "$ROOT/assets/pond-data.js" "$ROOT/assets/favicon.svg" assets/assets/

# Keep the signing key between builds, so a new APK installs over the old one without losing the pond.
[[ -f build/bichi.keystore ]] && cp build/bichi.keystore "$ROOT/android/.bichi.keystore.keep"
rm -rf build && mkdir -p build/gen build/classes build/dex
[[ -f "$ROOT/android/.bichi.keystore.keep" ]] && mv "$ROOT/android/.bichi.keystore.keep" build/bichi.keystore

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$AJ" --manifest AndroidManifest.xml -A assets build/res.zip \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"
javac --release 11 -Xlint:all -Xlint:-options -classpath "$AJ" -d build/classes java/com/bichi/koipond/*.java
"$BT/d8" --release --lib "$AJ" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -X ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk

if [[ ! -f build/bichi.keystore ]]; then
  keytool -genkeypair -keystore build/bichi.keystore -alias bichi -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass bichipond -keypass bichipond -dname "CN=Bichi Koi Pond" 2>/dev/null
fi
"$BT/apksigner" sign --ks build/bichi.keystore --ks-pass pass:bichipond --key-pass pass:bichipond \
  --out "build/碧池观鱼.apk" build/aligned.apk
"$BT/apksigner" verify "build/碧池观鱼.apk"
mkdir -p "$ROOT/dist" && cp "build/碧池观鱼.apk" "$ROOT/dist/碧池观鱼.apk"
echo "✓ build/碧池观鱼.apk ($(du -h "build/碧池观鱼.apk" | cut -f1)), also at dist/碧池观鱼.apk — transfer to a phone and install"
