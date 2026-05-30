/**
 * SomniAudio — thin JS bridge to the native SomniAudioModule.
 *
 * Path conventions expected by the native layer:
 *   voicePath  — absolute path OR file:// URI to somni_recording.m4a
 *   deltaPath  — absolute path OR file:// URI to the delta binaural asset
 *
 * Both paths can be obtained from expo-file-system / expo-asset before calling:
 *   import * as FileSystem from 'expo-file-system';
 *   const voicePath = FileSystem.documentDirectory + 'somni_recording.m4a';
 *
 *   import { Asset } from 'expo-asset';
 *   const [asset] = await Asset.loadAsync(require('./assets/audio/delta.mp3'));
 *   const deltaPath = asset.localUri!;   // already downloaded as file://…
 */

import { NativeModules, Platform } from 'react-native';

const { SomniAudioModule } = NativeModules;

function assertAvailable(): void {
  if (!SomniAudioModule) {
    throw new Error(
      'SomniAudioModule is not registered. Make sure you ran expo prebuild ' +
        'with the withSomniAudio plugin and rebuilt the native app.'
    );
  }
}

/**
 * Start the bedtime session.
 *
 * Timeline:
 *  0 min  — voice + delta both start; voice loops with 10-sec gaps
 *  8 min  — voice begins fading out over 4 minutes
 * 12 min  — everything stops
 */
export function startBedtime(voicePath: string, deltaPath: string): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  assertAvailable();
  return SomniAudioModule.startBedtime(voicePath, deltaPath);
}

/**
 * Start the morning session.
 *
 * Plays the voice recording 5 times in a row.
 * Fades volume in from 0 → 0.7 over the first 30 seconds, then holds.
 */
export function startMorning(voicePath: string): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  assertAvailable();
  return SomniAudioModule.startMorning(voicePath);
}

/**
 * Stop and tear down whichever session is running.
 * Safe to call when nothing is playing.
 */
export function stopAudio(): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  if (!SomniAudioModule) return Promise.resolve();
  return SomniAudioModule.stop();
}
