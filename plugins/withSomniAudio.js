const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SOURCE_DIR = path.join(__dirname, '..', 'modules', 'somni-audio', 'ios');

// ─── Step 1: Copy Swift file + register in ExpoModulesProvider ───────────────
// withDangerousMod gives us direct filesystem access during prebuild.
// By this point expo-modules-autolinking has already written ExpoModulesProvider.swift,
// so we can patch it to include SomniAudioModule.self in getModuleClasses().
function withCopySomniFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName;
      const targetDir = path.join(iosRoot, projectName);

      // Copy the Swift source file into the generated iOS project folder
      const src = path.join(SOURCE_DIR, 'SomniAudioModule.swift');
      const dst = path.join(targetDir, 'SomniAudioModule.swift');
      fs.copyFileSync(src, dst);
      console.log(`[withSomniAudio] Copied SomniAudioModule.swift → ios/${projectName}/SomniAudioModule.swift`);

      // Register the module in ExpoModulesProvider.swift so expo-modules-core
      // includes it in getModuleClasses() and makes it available via
      // requireNativeModule('SomniAudio') from JavaScript.
      const providerPath = path.join(targetDir, 'ExpoModulesProvider.swift');
      if (fs.existsSync(providerPath)) {
        let content = fs.readFileSync(providerPath, 'utf8');
        if (!content.includes('SomniAudioModule.self')) {
          // Locate the getModuleClasses return array and append our entry.
          // The pattern matches: func getModuleClasses ... return [ ... ]
          const patched = content.replace(
            /(func getModuleClasses[\s\S]*?return \[)([\s\S]*?)(\s+\])/,
            (_, before, items, close) => {
              const indentMatch = items.match(/\n(\s+)/);
              const indent = indentMatch ? indentMatch[1] : '      ';
              return `${before}${items}\n${indent}SomniAudioModule.self,${close}`;
            }
          );
          if (patched !== content) {
            fs.writeFileSync(providerPath, patched);
            console.log('[withSomniAudio] Registered SomniAudioModule.self in ExpoModulesProvider.swift');
          } else {
            console.warn('[withSomniAudio] Could not patch ExpoModulesProvider.swift — getModuleClasses pattern not matched');
          }
        }
      } else {
        console.warn(`[withSomniAudio] ExpoModulesProvider.swift not found at ${providerPath} — module will not be registered`);
      }

      return config;
    },
  ]);
}

// ─── Step 2: Register Swift file in project.pbxproj ──────────────────────────
// withXcodeProject adds SomniAudioModule.swift to the compiled sources build
// phase so Xcode compiles it as part of the app target.
function withXcodeSomniFiles(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectName = config.modRequest.projectName;

    const targetUUID = xcodeProject.getFirstTarget().uuid;
    const groupKey = xcodeProject.findPBXGroupKey({ name: projectName });
    const filePath = `${projectName}/SomniAudioModule.swift`;

    if (!xcodeProject.hasFile(filePath)) {
      xcodeProject.addSourceFile(filePath, { target: targetUUID }, groupKey);
      console.log('[withSomniAudio] Added SomniAudioModule.swift to Xcode project');
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
