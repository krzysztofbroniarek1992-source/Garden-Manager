#!/usr/bin/env bash
# Disposable CI emulator only. No production identity or business data is read.
set -euo pipefail
android_package=pl.broniarek.gardenmanager
adb shell svc data disable
adb shell svc wifi enable
for attempt in $(seq 1 80); do
  lan_wifi_state=$(adb shell ip -4 addr show wlan0 2>/dev/null || true)
  if [[ "$lan_wifi_state" == *"inet "* ]]; then break; fi
  sleep 0.5
done
[[ "$lan_wifi_state" == *"inet "* ]]
mkdir -p artifacts/lan-runtime
npm run desktop:compile
node lan-tests/emulator-server.cjs artifacts/lan-runtime > artifacts/lan-runtime/peer.log 2>&1 &
lan_peer_pid=$!
trap 'kill "$lan_peer_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 100); do
  if [ -s artifacts/lan-runtime/fixture.json ]; then break; fi
  sleep 0.1
done
test -s artifacts/lan-runtime/fixture.json
# LAN is enabled but mobile data remains disabled. No internet validation is needed.
adb shell svc data disable
adb shell svc wifi enable
# Copy invitations through stdin into the debug app's private files, never argv/logs.
adb shell "run-as $android_package mkdir -p files"
adb shell "run-as $android_package sh -c 'cat > files/gm011a-test.json'" < artifacts/lan-runtime/fixture.json
# The normal packaged application never executes shell commands or changes firewalls.
# In this disposable rooted CI emulator, deny app internet egress while retaining LAN.
adb root
adb wait-for-device
lan_uid=$(adb shell cmd package list packages -U "$android_package" | awk -v name="package:$android_package" '$1==name {sub(/^uid:/,"",$2);print $2}' | tr -d '\r')
test -n "$lan_uid"
adb shell iptables -N GM011A_TEST
adb shell iptables -A OUTPUT -m owner --uid-owner "$lan_uid" -j GM011A_TEST
adb shell iptables -A GM011A_TEST -d 10.0.0.0/8 -j RETURN
adb shell iptables -A GM011A_TEST -d 172.16.0.0/12 -j RETURN
adb shell iptables -A GM011A_TEST -d 192.168.0.0/16 -j RETURN
adb shell iptables -A GM011A_TEST -d 224.0.0.251/32 -p udp --dport 5353 -j RETURN
adb shell iptables -A GM011A_TEST -j REJECT
adb shell ip6tables -A OUTPUT -m owner --uid-owner "$lan_uid" -j REJECT
adb shell am force-stop "$android_package"
adb shell am instrument -w -r -e class "$android_package.LanTest" "$android_package.test/androidx.test.runner.AndroidJUnitRunner" | tee artifacts/android-lan-test.txt
grep -q 'OK (1 test)' artifacts/android-lan-test.txt
# Export only safe synthetic metrics, never fixture invitations or private key material.
if [ -f artifacts/lan-runtime/metrics.jsonl ]; then cp artifacts/lan-runtime/metrics.jsonl artifacts/android-lan-metrics.jsonl; fi
