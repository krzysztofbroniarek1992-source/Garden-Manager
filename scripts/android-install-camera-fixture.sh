#!/usr/bin/env bash
# ONLY a disposable, rooted CI emulator with -writable-system. No user's phone.
# Android 11+ limits implicit IMAGE_CAPTURE to preinstalled camera applications.
# The controlled external activity must be a system app to exercise the production
# intent unchanged. It still has a separate UID and needs the actual URI grants.
set -euo pipefail
if [ "$#" -ne 1 ] || [ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ]; then
  echo 'Requires a disposable writable-system emulator and one test fixture APK.' >&2
  exit 2
fi
boot_ready() {
  adb wait-for-device
  for attempt in $(seq 1 180); do
    if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then return; fi
    sleep 1
  done
  echo 'Emulator did not complete boot.' >&2
  exit 1
}
adb root
adb wait-for-device
adb disable-verity
adb reboot
boot_ready
adb root
adb wait-for-device
adb remount
adb shell mkdir -p /system/app/GMTestCamera
adb push "$1" /system/app/GMTestCamera/GMTestCamera.apk
adb shell chmod 644 /system/app/GMTestCamera/GMTestCamera.apk
adb reboot
boot_ready
adb shell pm list packages -s | tr -d '\r' | grep -Fx 'package:pl.broniarek.gardenmanager.fixture'
adb shell input keyevent 82
