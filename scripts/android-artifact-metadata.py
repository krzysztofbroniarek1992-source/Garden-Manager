#!/usr/bin/env python3
"""Public package/signing evidence only. No key material or passwords."""
import hashlib, json, os, re, subprocess
from pathlib import Path
apk = Path('artifacts/GardenManager-Android-debug.apk')
tool = Path(os.environ['ANDROID_HOME']) / 'build-tools/36.0.0/apksigner'
output = subprocess.check_output([str(tool), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
certificate = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)', output).group(1)
# Public certificate from GM-009A Actions run 42667937496, versionCode 3.
previous = '666f26c18426648a42ae4f8942673374c0cd06878867386a6093bf2b8030b49f'
badging = subprocess.check_output([str(tool.parent / 'aapt2'), 'dump', 'badging', str(apk)], text=True)
package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
assert package and package.groups() == ('pl.broniarek.gardenmanager', '4', '0.4.2-test.1'), 'Unexpected APK identity/version'
metadata = dict(applicationId=package[1], origin='https://localhost', versionName=package[3], versionCode=int(package[2]),
    apkSha256=hashlib.sha256(apk.read_bytes()).hexdigest(), certificateSha256=certificate,
    signingMode=os.environ.get('GM_SIGNING_MODE', 'local-debug'), previousRun=42667937496,
    previousCertificateSha256=previous, matchesPreviousRunCertificate=certificate==previous,
    note='A/B emulator update uses the same build key. Physical update compatibility requires the installed APK certificate to match.')
Path('artifacts/APK-METADATA.json').write_text(json.dumps(metadata, indent=2)+'\n')
print(json.dumps(metadata, indent=2))
