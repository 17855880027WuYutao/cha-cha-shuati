#!/bin/bash
# 手工搭 APK：aapt2 + javac + d8 + zipalign + apksigner（不装 Gradle）
# 用法：bash build.sh              # 自动找 Android SDK
#       ANDROID_SDK=/path/to/sdk bash build.sh
set -e

APP="$(cd "$(dirname "$0")" && pwd)"
WEB="$APP/../quiz/dist/刷题解析台.html"
OUT="$APP/build"
VER_NAME="${VER_NAME:-0.9.1}"
VER_CODE="${VER_CODE:-91}"
PKG="茶茶刷题"

# ---------- 找 SDK ----------
SDK="${ANDROID_SDK:-${ANDROID_HOME:-}}"
if [ -z "$SDK" ]; then
  for c in "$HOME/Android/Sdk" /d/Android/sdk "/c/Users/$USER/AppData/Local/Android/Sdk" /root/android/sdk; do
    if [ -d "$c" ]; then SDK="$c"; break; fi
  done
fi
[ -n "$SDK" ] || { echo "没找到 Android SDK，请设 ANDROID_SDK 指向它"; exit 1; }

BT=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
PLATFORM="$SDK/platforms/android-34/android.jar"
[ -f "$PLATFORM" ] || PLATFORM=$(ls "$SDK"/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)
[ -n "$BT" ] && [ -n "$PLATFORM" ] || { echo "SDK 里缺 build-tools 或 platforms"; exit 1; }
echo "SDK      $SDK"
echo "buildtool $(basename "$BT")"
echo "platform  $(basename "$(dirname "$PLATFORM")")"

pick() { # 兼容 Windows(.exe) 与 Linux 无后缀
  for e in "$1" "$1.exe"; do [ -f "$e" ] && { echo "$e"; return; }; done
  echo "$1"
}
AAPT2=$(pick "$BT/aapt2")
ZIPALIGN=$(pick "$BT/zipalign")

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/assets"
cp "$WEB" "$OUT/assets/app.html"

echo "== aapt2 compile res =="
"$AAPT2" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "== aapt2 link =="
"$AAPT2" link \
  -o "$OUT/app-unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$OUT/assets" \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  --version-code "$VER_CODE" \
  --version-name "$VER_NAME" \
  "$OUT/res.zip"

echo "== javac =="
javac --release 11 -classpath "$PLATFORM" -d "$OUT/classes" \
  $(find "$APP/src" -name '*.java')

echo "== d8 =="
if [ -f "$BT/lib/d8.jar" ]; then
  java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
    --lib "$PLATFORM" --min-api 26 --output "$OUT/dex" \
    $(find "$OUT/classes" -name '*.class')
else
  "$(pick "$BT/d8")" --lib "$PLATFORM" --min-api 26 --output "$OUT/dex" \
    $(find "$OUT/classes" -name '*.class')
fi

echo "== 把 classes.dex 装进 apk =="
jar --update --file "$OUT/app-unsigned.apk" -C "$OUT/dex" classes.dex
echo 'classes.dex ->' "$(stat -c%s "$OUT/dex/classes.dex")" 'bytes'

echo "== zipalign =="
"$ZIPALIGN" -f -p 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"

if [ ! -f "$APP/debug.keystore" ]; then
  keytool -genkeypair -keystore "$APP/debug.keystore" -alias androiddebugkey \
    -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Chacha Quiz, O=DSH, C=CN" >/dev/null 2>&1
fi

echo "== sign =="
if [ -f "$BT/lib/apksigner.jar" ]; then
  java -jar "$BT/lib/apksigner.jar" sign \
    --ks "$APP/debug.keystore" --ks-pass pass:android --key-pass pass:android \
    --out "$OUT/$PKG.apk" "$OUT/app-aligned.apk"
else
  "$(pick "$BT/apksigner")" sign \
    --ks "$APP/debug.keystore" --ks-pass pass:android --key-pass pass:android \
    --out "$OUT/$PKG.apk" "$OUT/app-aligned.apk"
fi

echo "== verify =="
if [ -f "$BT/lib/apksigner.jar" ]; then
  java -jar "$BT/lib/apksigner.jar" verify --print-certs "$OUT/$PKG.apk" | head -4
else
  "$(pick "$BT/apksigner")" verify --print-certs "$OUT/$PKG.apk" | head -4
fi
ls -lh "$OUT/$PKG.apk"
