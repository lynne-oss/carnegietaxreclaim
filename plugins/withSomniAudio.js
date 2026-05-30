const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SOURCE_DIR = path.join(__dirname, '..', 'modules', 'somni-audio', 'ios');

// ─── Step 1: Copy Swift file, delete stale .m, register in ExpoModulesProvider
function withCopySomniFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName;
      const targetDir = path.join(iosRoot, projectName);

      // Delete the ObjC bridge file if it was copied by a previous prebuild
      const staleM = path.join(targetDir, 'SomniAudioModule.m');
      if (fs.existsSync(staleM)) {
        fs.unlinkSync(staleM);
        console.log('[withSomniAudio] Deleted stale SomniAudioModule.m from ios directory');
      }

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

// ─── Step 2: Scrub .m from pbxproj + register Swift file ─────────────────────
// withXcodeProject adds SomniAudioModule.swift to the compiled sources build
// phase so Xcode compiles it as part of the app target.
function withXcodeSomniFiles(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectName = config.modRequest.projectName;

    const targetUUID = xcodeProject.getFirstTarget().uuid;
    const groupKey = xcodeProject.findPBXGroupKey({ name: projectName });

    // Remove SomniAudioModule.m from all pbxproj sections if still registered.
    // The old plugin added it; expo prebuild --clean regenerates project.pbxproj
    // from the config plugin output, so this guard handles the case where a
    // cached prebuild carries the stale entry forward.
    const mFilePath = `${projectName}/SomniAudioModule.m`;
    if (xcodeProject.hasFile(mFilePath)) {
      const objects = xcodeProject.hash.project.objects;

      // 1. Find the PBXFileReference UUID for the .m file
      const fileRefs = objects.PBXFileReference || {};
      let fileRefUUID = null;
      for (const [uuid, ref] of Object.entries(fileRefs)) {
        if (uuid.endsWith('_comment')) continue;
        const p = ref.path && ref.path.replace(/^"(.*)"$/, '$1');
        if (p === mFilePath || p === 'SomniAudioModule.m') {
          fileRefUUID = uuid;
          break;
        }
      }

      if (fileRefUUID) {
        // 2. Collect PBXBuildFile UUIDs that point to this fileRef
        const buildFiles = objects.PBXBuildFile || {};
        const buildFileUUIDs = Object.entries(buildFiles)
          .filter(([uuid, bf]) => !uuid.endsWith('_comment') && bf.fileRef === fileRefUUID)
          .map(([uuid]) => uuid);

        // 3. Remove those entries from every PBXSourcesBuildPhase files array
        const sourcePhases = objects.PBXSourcesBuildPhase || {};
        for (const [uuid, phase] of Object.entries(sourcePhases)) {
          if (uuid.endsWith('_comment') || !Array.isArray(phase.files)) continue;
          phase.files = phase.files.filter(f => !buildFileUUIDs.includes(f.value));
        }

        // 4. Delete the PBXBuildFile entries (and their _comment siblings)
        for (const uuid of buildFileUUIDs) {
          delete buildFiles[uuid];
          delete buildFiles[`${uuid}_comment`];
        }

        // 5. Delete the PBXFileReference entry (and _comment)
        delete fileRefs[fileRefUUID];
        delete fileRefs[`${fileRefUUID}_comment`];

        // 6. Remove from every PBXGroup children array
        const groups = objects.PBXGroup || {};
        for (const [uuid, group] of Object.entries(groups)) {
          if (uuid.endsWith('_comment') || !Array.isArray(group.children)) continue;
          group.children = group.children.filter(c => c.value !== fileRefUUID);
        }

        console.log('[withSomniAudio] Removed SomniAudioModule.m from project.pbxproj');
      }
    }

    // Add SomniAudioModule.swift to the compiled sources build phase
    const swiftFilePath = `${projectName}/SomniAudioModule.swift`;
    if (!xcodeProject.hasFile(swiftFilePath)) {
      xcodeProject.addSourceFile(swiftFilePath, { target: targetUUID }, groupKey);
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
