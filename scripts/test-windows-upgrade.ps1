$ErrorActionPreference = 'Stop'
$installerA = (Get-ChildItem release-windows-a -Filter *.exe | Select-Object -First 1).FullName
$installerB = (Get-ChildItem release-windows -Filter *.exe | Select-Object -First 1).FullName
$installRoot = Join-Path $env:RUNNER_TEMP 'GM010-Installation'
$env:GM_UPGRADE_PROFILE = Join-Path $env:RUNNER_TEMP 'GM010-Persistent-Profile'
$env:GM_UPGRADE_EXPECTED = Join-Path $env:RUNNER_TEMP 'GM010-Expected.json'
# Real NSIS /S install: a controlled generated installer, no SmartScreen bypass.
$p = Start-Process -FilePath $installerA -ArgumentList '/S',"/D=$installRoot" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Installer A failed: $($p.ExitCode)" }
$exe = Get-ChildItem $installRoot -Recurse -Filter 'Garden Manager.exe' | Select-Object -First 1
if (!$exe) { throw 'Installed EXE A missing' }
$env:GM_INSTALLED_APP = $exe.FullName
$env:GM_UPGRADE_PHASE = 'seed'
npm run test:desktop
if ($LASTEXITCODE -ne 0) { throw 'Version A seed failed' }
$p = Start-Process -FilePath $installerB -ArgumentList '/S',"/D=$installRoot" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Installer B failed: $($p.ExitCode)" }
$env:GM_UPGRADE_PHASE = 'verify'
npm run test:desktop
if ($LASTEXITCODE -ne 0) { throw 'Version B persistence verification failed' }
Remove-Item Env:GM_UPGRADE_PHASE
$signature = Get-AuthenticodeSignature $installerB
if ($signature.Status -ne 'NotSigned') { throw "Unexpected test signature status: $($signature.Status)" }
Write-Host 'REAL NSIS A -> B update passed; clients, photo bytes, expense and timer preserved.'
