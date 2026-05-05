const { withAppDelegate } = require('@expo/config-plugins');

/**
 * Xcode 26 (Swift 6) fails with "cannot find ExpoAppDelegate in scope"
 * because expo prebuild generates `internal import Expo`. The `internal`
 * access-level qualifier limits type visibility in ways that break
 * cross-module class inheritance for the @main entry point class.
 * This plugin strips the `internal` keyword via the official
 * withAppDelegate modifier so the superclass resolves correctly.
 */
module.exports = function withFixedAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      console.warn('[withFixedAppDelegate] AppDelegate is not Swift — skipping');
      return config;
    }

    const original = config.modResults.contents;

    if (/^\s*internal\s+import\s+Expo\b/m.test(original)) {
      // Generated template has `internal import Expo` — strip the qualifier
      config.modResults.contents = original.replace(
        /^(\s*)internal\s+(import\s+Expo\b)/m,
        '$1$2'
      );
      console.log('[withFixedAppDelegate] Replaced `internal import Expo` with `import Expo`');
    } else if (!/^\s*import\s+Expo\b/m.test(original)) {
      // import Expo missing entirely — insert at top
      config.modResults.contents = `import Expo\n${original}`;
      console.log('[withFixedAppDelegate] Inserted missing `import Expo`');
    } else {
      console.log('[withFixedAppDelegate] AppDelegate already correct — no changes needed');
    }

    return config;
  });
};
