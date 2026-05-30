/**
 * SomniAudio — thin JS bridge to the native SomniAudioModule (expo-modules-core).
 *
 * Path conventions expected by the native layer:
 *   voicePath  — absolute path OR file:// URI to somni_recording.m4a
 *   deltaPath  — absolute path OR file:// URI to the delta binaural asset
 *
 * Resolve paths before calling:
 *   import * as FileSystem from 'expo-file-system';
 *   const voicePath = FileSystem.documentDirectory + 'somni_recording.m4a';
 *
 *   import { Asset } from 'expo-asset';
 *   const [asset] = await Asset.loadAsync(require('./assets/audio/delta.mp3'));
 *   const deltaPath = asset.localUri!;
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

interface SomniAudioNativeModule {
  startBedtime(voicePath: string, deltaPath: string): Promise<void>;
  startMorning(voicePath: string): Promise<void>;
  stop(): Promise<void>;
}

const NativeModule = requireOptionalNativeModule<SomniAudioNativeModule>('SomniAudio');

/**
 * Start the bedtime session.
 *
 * Timeline:
 *  0 min  — voice + delta both start; voice loops with 10-sec gaps
 *  8 min  — voice begins fading out over 4 minutes
 * 12 min  — everything stops
 */
export function startBedtime(voicePath: string, deltaPath: string): Promise<void> {
  if (!NativeModule) return Promise.resolve();
  return NativeModule.startBedtime(voicePath, deltaPath);
}

/**
 * Start the morning session.
 *
 * Plays the voice recording 5 times in a row.
 * Fades volume in from 0 → 0.7 over the first 30 seconds, then holds.
 */
export function startMorning(voicePath: string): Promise<void> {
  if (!NativeModule) return Promise.resolve();
  return NativeModule.startMorning(voicePath);
}

/**
 * Stop and tear down whichever session is running.
 * Safe to call when nothing is playing.
 */
export function stopAudio(): Promise<void> {
  if (!NativeModule) return Promise.resolve();
  return NativeModule.stop();
}
