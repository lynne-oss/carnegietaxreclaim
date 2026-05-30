#import <React/RCTBridgeModule.h>

// Declares SomniAudioModule to the React Native bridge without importing
// Swift headers directly. The Swift class is found at link time.
RCT_EXTERN_MODULE(SomniAudioModule, NSObject)

RCT_EXTERN_METHOD(startBedtime:(NSString *)voicePath
                  deltaPath:(NSString *)deltaPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startMorning:(NSString *)voicePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}
