#!/usr/bin/env bash
# Compile ezPDF's Android Java (EzFilesPlugin, MainActivity) against
# android.jar and Capacitor's method signatures (tests/android-stubs).
# Needs a JDK and an android.jar, e.g. `apt install android-sdk-platform-23`
# or ANDROID_JAR=$ANDROID_HOME/platforms/android-36/android.jar.
set -euo pipefail
cd "$(dirname "$0")/.."
JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -d "$OUT" \
  $(find tests/android-stubs -name '*.java') android/app/src/main/java/app/ezpdf/*.java
ls "$OUT/app/ezpdf"
echo "android java: compiles against $(basename "$(dirname "$JAR")")"
