#!/usr/bin/env bash
# Destructive only to the supplied test installation: use a disposable emulator/profile.
# APK A/B and instrumentation APK must be built with the same debug key.
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo 'Usage: android-device-check.sh APK_A APK_B TEST_APK' >&2
  exit 2
fi
android_package=pl.broniarek.gardenmanager
run_device_test() {
  local android_test_output
  android_test_output=$(adb shell am instrument -w -r -e class "$1" "$android_package.test/androidx.test.runner.AndroidJUnitRunner")
  printf '%s\n' "$android_test_output"
  if ! [[ "$android_test_output" =~ OK\ \([0-9]+\ test ]]; then
    mkdir -p artifacts
    timeout 15s adb logcat -d > artifacts/android-logcat.txt || true
    timeout 15s adb exec-out screencap -p > artifacts/android-failure.png || true
    timeout 15s adb shell uiautomator dump /sdcard/gm009-window.xml >/dev/null || true
    adb pull /sdcard/gm009-window.xml artifacts/android-window.xml >/dev/null 2>&1 || true
    echo 'Instrumentation failed or did not execute tests.' >&2
    exit 1
  fi
}
adb wait-for-device
# Keep adb alive; block the emulator's actual network for the first launch.
adb shell svc wifi disable
adb shell svc data disable
adb shell cmd connectivity airplane-mode enable
adb install -r "$1"
adb install -r "$3"
run_device_test "$android_package.NativeSmokeTest"
run_device_test "$android_package.UpgradeDataTest#seedBeforeUpdate"
adb shell am force-stop "$android_package"
adb install -r "$2"
run_device_test "$android_package.UpgradeDataTest#verifyAfterUpdate"
adb shell am force-stop "$android_package"
run_device_test "$android_package.UpgradeDataTest#verifyAfterUpdate"
adb shell am force-stop "$android_package"
run_device_test "$android_package.ExpensesTest"
