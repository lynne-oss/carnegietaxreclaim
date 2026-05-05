#!/usr/bin/env node
/**
 * Patches two Expo files that generate `internal import` Swift statements.
 * Under Xcode 26 / Swift 6, `internal import` in the app target causes
 * "cannot find 'ExpoAppDelegate' in scope" and similar cascade failures.
 *
 * 1. node_modules/expo-modules-autolinking/build/platforms/apple/apple.js
 *    Generates ExpoModulesProvider.swift with `internal import ExpoModulesCore`
 *    and `internal import <every linked module>` — strips `internal`.
 *
 * 2. node_modules/expo/template.tgz
 *    AppDelegate.swift template has `internal import Expo` — strips `internal`.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ── 1. Patch apple.js (ExpoModulesProvider.swift generator) ─────────────────

const appleJsPath = path.join(
  ROOT,
  'node_modules/expo-modules-autolinking/build/platforms/apple/apple.js'
);

if (fs.existsSync(appleJsPath)) {
  let src = fs.readFileSync(appleJsPath, 'utf8');
  const before = src;

  // Hardcoded literal in template: `internal import ExpoModulesCore`
  src = src.replace(/\binternal import ExpoModulesCore\b/g, 'import ExpoModulesCore');

  // Hardcoded literal in template: `internal class ${className}`
  src = src.replace(/\binternal class \$\{className\}/g, 'class ${className}');

  // Generated import lists: `internal import ${moduleName}` template literal
  src = src.replace(/`internal import \$\{moduleName\}`/g, '`import ${moduleName}`');

  if (src !== before) {
    fs.writeFileSync(appleJsPath, src, 'utf8');
    console.log('[patch-expo-swift] Patched apple.js — ExpoModulesProvider.swift will use plain `import`');
  } else {
    console.log('[patch-expo-swift] apple.js already patched');
  }
} else {
  console.warn('[patch-expo-swift] WARNING: apple.js not found at', appleJsPath);
}

// ── 2. Patch expo/template.tgz (AppDelegate.swift template) ─────────────────

const templatePath = path.join(ROOT, 'node_modules/expo/template.tgz');

if (!fs.existsSync(templatePath)) {
  console.warn('[patch-expo-swift] WARNING: template.tgz not found at', templatePath);
  process.exit(0);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-template-'));

try {
  execSync(`tar -xzf "${templatePath}" -C "${tmpDir}"`, { stdio: 'pipe' });

  const appDelegatePath = path.join(tmpDir, 'package/ios/HelloWorld/AppDelegate.swift');
  if (!fs.existsSync(appDelegatePath)) {
    console.warn('[patch-expo-swift] WARNING: AppDelegate.swift not found in template.tgz');
    process.exit(0);
  }

  const original = fs.readFileSync(appDelegatePath, 'utf8');
  const patched = original.replace(/^(\s*)internal\s+(import\s+Expo\b)/m, '$1$2');

  if (patched === original) {
    console.log('[patch-expo-swift] template.tgz AppDelegate.swift already correct');
    process.exit(0);
  }

  fs.writeFileSync(appDelegatePath, patched, 'utf8');

  execSync(`tar -czf "${templatePath}" -C "${tmpDir}" package`, { stdio: 'pipe' });

  console.log('[patch-expo-swift] Patched expo/template.tgz — AppDelegate.swift now uses plain `import Expo`');
} catch (err) {
  console.error('[patch-expo-swift] ERROR:', err.message);
  process.exit(1);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
