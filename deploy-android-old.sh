#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# --- Android deploy helper for Ionic/Capacitor projects ---
# Usage:
#   ./deploy-android.sh [-d DEVICE_ID] [-l] [-s] [-v] [--logcat] [--clean] [--release] [--remember] [--forget]
# Options:
#   -d DEVICE_ID   ADB device id (e.g., ZY32BV7R4V). If omitted, falls back to: $ANDROID_SERIAL > cached device > first physical.
#   -l             Live reload via Ionic CLI (uses --external). Falls back to regular run if Ionic unavailable.
#   -s             Skip web build (use existing /dist).
#   -v             Verbose (pass --verbose/--info to tools where possible).
#   --logcat       Stream device logs (push/notification-focused filter).
#   --clean        Clean Android build cache before run.
#   --release      Build, install and launch a *release* APK (Gradle assembleRelease).
#   --remember     Cache the detected/used device id for next runs (~/.config/ourglp1/android-device).
#   --forget       Remove the cached device id before resolving device.
#
# Examples:
#   ./deploy-android.sh
#   ./deploy-android.sh -d ZT322JGPF2
#   ./deploy-android.sh --remember
#   ./deploy-android.sh --release --logcat

DEVICE_ID="${DEVICE_ID:-}"
LIVE=0
SKIP_BUILD=0
VERBOSE=0
DO_LOGCAT=0
DO_CLEAN=0
RELEASE=0
REMEMBER=0
FORGET=0
PACKAGE_DEFAULT="com.ourglp1.app"
PACKAGE="${PACKAGE:-}"

CACHE_FILE="${HOME}/.config/ourglp1/android-device"
mkdir -p "$(dirname "$CACHE_FILE")"

have() { command -v "$1" >/dev/null 2>&1; }
die() { echo "❌ $*" >&2; exit 1; }
step() { echo; echo "▶ $*"; }

usage() {
  sed -n '1,60p' "$0"
 echo
  echo "Usage: ./deploy-android.sh [-d DEVICE_ID] [-l] [-s] [-v] [--logcat] [--clean] [--release] [--remember] [--forget]"
}

# Parse args
while (( "$#" )); do
  case "${1:-}" in
    -d) DEVICE_ID="${2:-}"; shift 2;;
    -l) LIVE=1; shift;;
    -s) SKIP_BUILD=1; shift;;
    -v) VERBOSE=1; shift;;
    --logcat) DO_LOGCAT=1; shift;;
    --clean) DO_CLEAN=1; shift;;
    --release) RELEASE=1; shift;;
    --remember) REMEMBER=1; shift;;
    --forget) FORGET=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "Unknown option: $1";;
  esac
done

# Prereqs
for bin in adb npm npx; do have "$bin" || die "'$bin' not found in PATH."; done
[[ -f package.json ]] || die "package.json not found. Run this from your project root."

# Resolve package name from AndroidManifest (fallback to default)
if [[ -z "$PACKAGE" ]]; then
  if [[ -f android/app/src/main/AndroidManifest.xml ]]; then
    PACKAGE="$(grep -oE 'package="[^"]+"' android/app/src/main/AndroidManifest.xml | head -1 | cut -d'"' -f2 || true)"
  fi
  PACKAGE="${PACKAGE:-$PACKAGE_DEFAULT}"
fi

# Optionally forget cached device
if (( FORGET )) && [[ -f "$CACHE_FILE" ]]; then
  rm -f "$CACHE_FILE"
fi

# Resolve device id priority: explicit -d > ANDROID_SERIAL > cached > first physical
if [[ -z "$DEVICE_ID" ]]; then
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    DEVICE_ID="$ANDROID_SERIAL"
  elif [[ -f "$CACHE_FILE" ]]; then
    DEVICE_ID="$(<"$CACHE_FILE")"
else
    DEVICE_ID="$(adb devices -l | awk '/\bdevice$|\bdevice / && $1 !~ /List|emulator/ {print $1; exit}')"
  fi
fi
[[ -n "$DEVICE_ID" ]] || die "No Android device found. Plug in a phone with USB debugging enabled or pass -d DEVICE_ID."

# Optionally remember for next time
if (( REMEMBER )); then
  echo "$DEVICE_ID" > "$CACHE_FILE"
fi

echo "   Using device: ${DEVICE_ID}  (pkg: ${PACKAGE})"
ADB_TGT=( -s "$DEVICE_ID" )

# Heads-up for FCM
if [[ ! -f android/app/google-services.json ]]; then
  echo "⚠️  android/app/google-services.json not found (FCM push may not work on Android)."
fi

# Optional: clean Gradle cache
if (( DO_CLEAN )); then
  step "Cleaning Android build cache"
  (cd android && ./gradlew --stop >/dev/null 2>&1 || true)
  (cd android && ./gradlew clean ${VERBOSE:+--info})
fi

# Build web assets
if (( ! SKIP_BUILD )); then
  step "Building web assets"
  npm run -s build || die "Web build failed"
else
  echo "⏭️   Skipping web build (using existing /dist)."
fi

# Sync Capacitor
step "Syncing Capacitor (android)"
npx cap sync android

if (( RELEASE )); then
  # Release build via Gradle + manual install/launch
  step "Gradle assembleRelease"
  (cd android && ./gradlew ${VERBOSE:+--info} assembleRelease)
 APK="android/app/build/outputs/apk/release/app-release.apk"
  [[ -f "$APK" ]] || die "Release APK not found at $APK"

  step "Installing release APK"
  adb "${ADB_TGT[@]}" install -r "$APK"

  step "Launching app"
  adb "${ADB_TGT[@]}" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1
else
  # Debug: use Capacitor to build+install+run
  step "Installing & launching debug build"
  if (( LIVE )); then
    if have ionic; then IONIC_CMD="ionic"; else IONIC_CMD="npx @ionic/cli@latest"; fi
    set +e
    $IONIC_CMD cap run android -l --external --target "$DEVICE_ID"
    STATUS=$?
    set -e
    if (( STATUS != 0 )); then
      echo "⚠️  Live reload failed or unsupported. Falling back to regular run."
      LIVE=0
    fi
  fi
  if (( ! LIVE )); then
    npx cap run android --target "$DEVICE_ID"
  fi
fi

# Quick sanity: is the reminders channel visible now?
step "Checking 'reminders' notification channel"
adb "${ADB_TGT[@]}" shell dumpsys notification --noredact \
  | sed -n "/AppSettings: $PACKAGE/,/^\s*AppSettings:/p" \
  | grep -i "NotificationChannel{mId='reminders'" -n \
  || echo "ℹ️  Channel not listed yet (it will be created at runtime by the app)."

# Optional logs
if (( DO_LOGCAT )); then
  step "Tailing device logs (Ctrl+C to exit)"
  adb "${ADB_TGT[@]}" logcat -v time | grep -i -E "PushNotifications|Firebase|FCM|Capacitor/Push|PC-Channel|notification"
fi

echo "✅ Deploy complete."
