module.exports={
 appId:'pl.broniarek.gardenmanager.windows',productName:'Garden Manager',
 extraMetadata:{version:process.env.GM_WINDOWS_VERSION||'0.5.0-test.2'},
 buildVersion:process.env.GM_WINDOWS_BUILD_VERSION||'0.5.0.2',
 directories:{output:process.env.GM_WINDOWS_OUTPUT||'release-windows'},
 files:['dist-windows/**/*','desktop/build/**/*','desktop/assets/**/*','package.json'],
 asar:true,npmRebuild:false,
 win:{target:[{target:'nsis',arch:['x64']}],icon:'desktop/assets/icon.ico',artifactName:'GardenManager-Windows-${version}-x64-test.${ext}',signAndEditExecutable:true},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createStartMenuShortcut:true,createDesktopShortcut:false,shortcutName:'Garden Manager',deleteAppDataOnUninstall:false,runAfterFinish:false,include:'desktop/installer.nsh',installerIcon:'desktop/assets/icon.ico',uninstallerIcon:'desktop/assets/icon.ico'},
};
