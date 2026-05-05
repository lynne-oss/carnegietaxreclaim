const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Xcode 26 (Swift 6) rejects `internal import Expo` as a superclass source for
 * ExpoAppDelegate, producing "cannot find ExpoAppDelegate in scope".
 * Replacing it with a plain `import Expo` restores normal module visibility.
 */
module.exports = function withFixedAppDelegate(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const appName = config.modRequest.projectName;
      const filePath = path.join(
        config.modRequest.platformProjectRoot,
        appName,
        'AppDelegate.swift'
      );

      if (!fs.existsSync(filePath)) return config;

      const original = fs.readFileSync(filePath, 'utf8');
      const patched = original.replace(/^internal import Expo$/m, 'import Expo');

      if (patched !== original) {
        fs.writeFileSync(filePath, patched, 'utf8');
      }

      return config;
    },
  ]);
};
