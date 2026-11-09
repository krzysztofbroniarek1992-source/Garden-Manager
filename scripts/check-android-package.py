#!/usr/bin/env python3
"""Check the actual APK, not only the Vite output. Does not claim a device run."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

apk = Path(sys.argv[1])
with zipfile.ZipFile(apk) as package:
    names = package.namelist()
    config = json.loads(package.read('assets/capacitor.config.json'))
    assert config['appId'] == 'pl.broniarek.gardenmanager'
    assert config['server'] == {'hostname': 'localhost', 'androidScheme': 'https'}
    assert not config.get('server', {}).get('url'), 'Remote development server in APK'
    assets = [n for n in names if n.startswith('assets/public/')]
    assert 'assets/public/index.html' in assets
    assert 'assets/public/fonts/DejaVuSans.ttf' in assets
    assert 'assets/public/fonts/DejaVuSans-Bold.ttf' in assets
    for prefix in ('index-', 'react-vendor-', 'pdf-engine-', 'pdf-fontkit-', 'pdf-'):
        assert any('/'+prefix in n and n.endswith('.js') for n in assets), prefix
    assert any(n.endswith('.css') for n in assets)
    assert not any(n.endswith(('/sw.js', '/registerSW.js')) or '/workbox-' in n for n in assets)
    assert any(n.startswith('META-INF/') for n in names)
print(f'APK assets/origin OK: {apk.name} ({apk.stat().st_size} bytes)')
print('SHA256:', hashlib.sha256(apk.read_bytes()).hexdigest())
