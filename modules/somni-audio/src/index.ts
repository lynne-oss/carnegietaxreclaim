import { requireOptionalNativeModule } from 'expo-modules-core';

interface SomniAudioNativeModule {
  startBedtime(voicePath: string, deltaPath: string): Promise<void>;
  startMorning(voicePath: string): Promise<void>;
  stop(): Promise<void>;
}

const NativeModule = requireOptionalNativeModule<SomniAudioNativeModule>('SomniAudio');

export function startBedtime(voicePath: string, deltaPath: string): Promise<void> {
  if (!NativeModule) return Promise.resolve();
  return NativeModule.startBedtime(voicePath, deltaPath);
}

export function startMorning(voicePath: string): Promise<void> {
  if (!NativeModule) return Promise.resolve();
  return NativeModule.startMorning(voicePath);
}

export function stopAudio(): Promise<void> {
  if (!NativeModule) return Promise.resolve();
  return NativeModule.stop();
}
