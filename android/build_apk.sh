#!/bin/bash
# dist/index.html を WebView で表示する Android アプリ（APK）を作る。
# 必要なツールは Maven Central から取得する（Android SDK は不要）:
#   apktool-lib（同梱の aapt2 と android-framework.jar を使う）, smali 2.5.2, apksig 2.3.0
# 使い方: android/build_apk.sh   → dist/fe-kamoku-a.apk
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
WORK=${WORK:-$HERE/.build}
KEYSTORE=${KEYSTORE:-$HERE/release.keystore}
KEYPASS=${KEYPASS:-fekamokua}
VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}
MAVEN=${MAVEN:-https://maven-central.storage-download.googleapis.com/maven2}
mkdir -p "$WORK/lib" "$WORK/bin"

fetch() { [ -s "$WORK/lib/$(basename "$1")" ] || curl -fsS -o "$WORK/lib/$(basename "$1")" "$MAVEN/$1"; }
fetch org/apktool/apktool-lib/3.0.3/apktool-lib-3.0.3.jar
fetch com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
for a in org/smali/smali/2.5.2/smali-2.5.2.jar org/smali/dexlib2/2.5.2/dexlib2-2.5.2.jar \
         org/smali/util/2.5.2/util-2.5.2.jar com/google/guava/guava/27.1-android/guava-27.1-android.jar \
         com/beust/jcommander/1.64/jcommander-1.64.jar org/antlr/antlr-runtime/3.5.2/antlr-runtime-3.5.2.jar; do fetch "$a"; done
if [ ! -x "$WORK/bin/aapt2" ]; then
  unzip -o -q -j "$WORK/lib/apktool-lib-3.0.3.jar" prebuilt/linux/aapt2 prebuilt/android-framework.jar -d "$WORK/bin"
  chmod +x "$WORK/bin/aapt2"
fi

# アプリ本体を最新にして assets に入れる
python3 "$ROOT/build.py" >/dev/null
rm -rf "$WORK/assets" "$WORK/res.zip" "$WORK"/*.apk "$WORK/classes.dex"
mkdir -p "$WORK/assets"
cp "$ROOT/dist/index.html" "$WORK/assets/index.html"

# リソースとマニフェスト
"$WORK/bin/aapt2" compile --dir "$HERE/res" -o "$WORK/res.zip"
"$WORK/bin/aapt2" link -I "$WORK/bin/android-framework.jar" --manifest "$HERE/AndroidManifest.xml" \
  -A "$WORK/assets" --min-sdk-version 29 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -o "$WORK/base.apk" "$WORK/res.zip"

# smali → classes.dex
java -cp "$WORK/lib/*" org.jf.smali.Main assemble -a 29 -o "$WORK/classes.dex" "$HERE/smali"

# dex を加えて整列，署名
python3 "$HERE/tools/pack.py" "$WORK/base.apk" "$WORK/classes.dex" "$WORK/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -storepass "$KEYPASS" -keypass "$KEYPASS" \
    -alias app -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=FE Kamoku A Drill" >/dev/null
fi
mkdir -p "$WORK/classes"
javac -d "$WORK/classes" -cp "$WORK/lib/apksig-2.3.0.jar" "$HERE/tools/Sign.java"
mkdir -p "$ROOT/dist"
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$WORK/classes:$WORK/lib/apksig-2.3.0.jar" Sign "$WORK/aligned.apk" "$ROOT/dist/fe-kamoku-a.apk" "$KEYSTORE" "$KEYPASS" app
ls -la "$ROOT/dist/fe-kamoku-a.apk"
