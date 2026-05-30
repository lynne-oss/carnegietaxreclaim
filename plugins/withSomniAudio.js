const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SOURCE_DIR = path.join(__dirname, '..', 'modules', 'somni-audio', 'ios');
const MODULE_FILES = ['SomniAudioModule.swift', 'SomniAudioModule.m'];

// ─── Step 1: Copy files + patch bridging header ───────────────────────────────
// withDangerousMod gives us direct filesystem access during prebuild.
// It runs after the initial iOS project structure is written to disk.
function withCopySomniFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName;
      const targetDir = path.join(iosRoot, projectName);

      // Copy Swift and ObjC bridge files into the generated iOS project folder
      for (const file of MODULE_FILES) {
        const src = path.join(SOURCE_DIR, file);
        const dst = path.join(targetDir, file);
        fs.copyFileSync(src, dst);
        console.log(`[withSomniAudio] Copied ${file} → ios/${projectName}/${file}`);
      }

      // Ensure the bridging header imports RCTBridgeModule so Swift can
      // reference RCTPromiseResolveBlock / RCTPromiseRejectBlock without
      // importing React headers directly in the Swift file.
      const bridgingHeader = path.join(targetDir, `${projectName}-Bridging-Header.h`);
      if (fs.existsSync(bridgingHeader)) {
        let content = fs.readFileSync(bridgingHeader, 'utf8');
        if (!content.includes('<React/RCTBridgeModule.h>')) {
          content = '#import <React/RCTBridgeModule.h>\n' + content;
          fs.writeFileSync(bridgingHeader, content);
          console.log('[withSomniAudio] Added RCTBridgeModule import to bridging header');
        }
      } else {
        // Header doesn't exist yet — create it
        fs.writeFileSync(bridgingHeader, '#import <React/RCTBridgeModule.h>\n');
        console.log('[withSomniAudio] Created bridging header with RCTBridgeModule import');
      }

      return config;
    },
  ]);
}

// ─── Step 2: Register files in project.pbxproj ────────────────────────────────
// withXcodeProject gives us the parsed xcode project object (from the `xcode`
// npm package). We add both files as compiled sources on the app target.
function withXcodeSomniFiles(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectName = config.modRequest.projectName;

    // Resolve the main app target UUID
    const targetUUID = xcodeProject.getFirstTarget().uuid;

    // Resolve the PBX group that contains the app's Swift sources
    const groupKey = xcodeProject.findPBXGroupKey({ name: projectName });

    for (const file of MODULE_FILES) {
      const filePath = `${projectName}/${file}`;

      // Guard: don't double-add if a previous prebuild already registered it
      if (!xcodeProject.hasFile(filePath)) {
        xcodeProject.addSourceFile(filePath, { target: targetUUID }, groupKey);
        console.log(`[withSomniAudio] Added ${file} to Xcode project`);
      }
    }

    return config;
  });
}

// ─── Compose ──────────────────────────────────────────────────────────────────
module.exports = function withSomniAudio(config) {
  config = withCopySomniFiles(config);
  config = withXcodeSomniFiles(config);
  return config;
};
