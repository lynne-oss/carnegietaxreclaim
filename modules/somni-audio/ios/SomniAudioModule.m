#import <React/RCTBridgeModule.h>

// RCT_EXTERN_MODULE must be prefixed with @interface and closed with @end.
// The macro expands into partial ObjC class scaffolding; @interface/@end
// provide the outer structure that lets Xcode parse it correctly.
@interface RCT_EXTERN_MODULE(SomniAudioModule, NSObject)

RCT_EXTERN_METHOD(startBedtime:(NSString *)voicePath
                  deltaPath:(NSString *)deltaPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startMorning:(NSString *)voicePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
