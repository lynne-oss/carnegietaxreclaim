import Foundation
import AVFoundation

@objc(SomniAudioModule)
class SomniAudioModule: NSObject, AVAudioPlayerDelegate {

  // MARK: - State

  private var voicePlayer: AVAudioPlayer?
  private var deltaPlayer: AVAudioPlayer?

  // Four independent timers — each has a single job
  private var voiceGapTimer: Timer?      // 10-sec gap between bedtime loops
  private var fadeOutStartTimer: Timer?  // fires at 8 min to begin fade-out
  private var fadeOutTickTimer: Timer?   // per-tick volume reduction during fade-out
  private var masterStopTimer: Timer?    // hard stop at 12 min
  private var fadeInTickTimer: Timer?    // morning fade-in ticks

  private var voiceURL: URL?
  private var isBedtimeSession = false
  private var isMorningSession = false
  private var morningLoopCount = 0
  private var isFadingOut = false

  // MARK: - Audio Session

  private func configureSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default)
    try session.setActive(true)
  }

  // MARK: - URL Helper

  private func url(from path: String) -> URL {
    if path.hasPrefix("file://") {
      return URL(string: path) ?? URL(fileURLWithPath: path)
    }
    return URL(fileURLWithPath: path)
  }

  // MARK: - Bedtime Session

  @objc(startBedtime:deltaPath:resolver:rejecter:)
  func startBedtime(
    _ voicePath: String,
    deltaPath: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.tearDownAll()

      do {
        try self.configureSession()

        let voiceURL = self.url(from: voicePath)
        let deltaURL = self.url(from: deltaPath)
        self.voiceURL = voiceURL
        self.isBedtimeSession = true
        self.isMorningSession = false
        self.morningLoopCount = 0
        self.isFadingOut = false

        // Delta track loops forever beneath the voice at lower volume
        self.deltaPlayer = try AVAudioPlayer(contentsOf: deltaURL)
        self.deltaPlayer?.volume = 0.3
        self.deltaPlayer?.numberOfLoops = -1
        self.deltaPlayer?.prepareToPlay()
        self.deltaPlayer?.play()

        // Voice plays once; the delegate restarts it after a 10-sec gap
        self.voicePlayer = try AVAudioPlayer(contentsOf: voiceURL)
        self.voicePlayer?.volume = 1.0
        self.voicePlayer?.numberOfLoops = 0
        self.voicePlayer?.delegate = self
        self.voicePlayer?.prepareToPlay()
        self.voicePlayer?.play()

        // At 8 minutes, begin fading the voice out over the next 4 minutes
        self.fadeOutStartTimer = Timer.scheduledTimer(
          withTimeInterval: 8 * 60,
          repeats: false
        ) { [weak self] _ in
          self?.beginVoiceFadeOut()
        }

        // Hard stop at 12 minutes regardless of anything else
        self.masterStopTimer = Timer.scheduledTimer(
          withTimeInterval: 12 * 60,
          repeats: false
        ) { [weak self] _ in
          self?.tearDownAll()
        }

        resolve(nil)
      } catch {
        reject("SOMNI_AUDIO_ERROR", "Bedtime session failed: \(error.localizedDescription)", error)
      }
    }
  }

  // MARK: - Morning Session

  @objc(startMorning:resolver:rejecter:)
  func startMorning(
    _ voicePath: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.tearDownAll()

      do {
        try self.configureSession()

        let voiceURL = self.url(from: voicePath)
        self.voiceURL = voiceURL
        self.isMorningSession = true
        self.isBedtimeSession = false
        self.morningLoopCount = 0

        // Start silent; fade in to 0.7 over 30 seconds
        self.voicePlayer = try AVAudioPlayer(contentsOf: voiceURL)
        self.voicePlayer?.volume = 0.0
        self.voicePlayer?.numberOfLoops = 0
        self.voicePlayer?.delegate = self
        self.voicePlayer?.prepareToPlay()
        self.voicePlayer?.play()

        self.startMorningFadeIn(targetVolume: 0.7, overSeconds: 30.0)

        resolve(nil)
      } catch {
        reject("SOMNI_AUDIO_ERROR", "Morning session failed: \(error.localizedDescription)", error)
      }
    }
  }

  private func startMorningFadeIn(targetVolume: Float, overSeconds: Float) {
    let tickInterval: TimeInterval = 0.1
    let steps = overSeconds / Float(tickInterval)
    let step = targetVolume / steps

    fadeInTickTimer = Timer.scheduledTimer(withTimeInterval: tickInterval, repeats: true) { [weak self] t in
      guard let self = self, let player = self.voicePlayer else { t.invalidate(); return }
      let next = min(player.volume + step, targetVolume)
      player.volume = next
      if next >= targetVolume { t.invalidate(); self.fadeInTickTimer = nil }
    }
  }

  // MARK: - Bedtime Fade-Out

  private func beginVoiceFadeOut() {
    guard isBedtimeSession, !isFadingOut, let player = voicePlayer else { return }
    isFadingOut = true

    // Stop looping — fade handles the wind-down from here
    voiceGapTimer?.invalidate()
    voiceGapTimer = nil

    let fadeDuration: Float = 4 * 60   // 240 seconds
    let tickInterval: TimeInterval = 0.5
    let ticks = fadeDuration / Float(tickInterval)
    let startVolume = player.volume
    let step = startVolume / ticks

    fadeOutTickTimer = Timer.scheduledTimer(withTimeInterval: tickInterval, repeats: true) { [weak self] t in
      guard let self = self, let p = self.voicePlayer else { t.invalidate(); return }
      let next = max(p.volume - step, 0.0)
      p.volume = next
      if next <= 0.0 {
        p.stop()
        t.invalidate()
        self.fadeOutTickTimer = nil
      }
    }
  }

  // MARK: - Stop (public)

  @objc(stop:rejecter:)
  func stop(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async { [weak self] in
      self?.tearDownAll()
      resolve(nil)
    }
  }

  // MARK: - Internal Teardown

  private func tearDownAll() {
    voiceGapTimer?.invalidate();     voiceGapTimer = nil
    fadeOutStartTimer?.invalidate(); fadeOutStartTimer = nil
    fadeOutTickTimer?.invalidate();  fadeOutTickTimer = nil
    masterStopTimer?.invalidate();   masterStopTimer = nil
    fadeInTickTimer?.invalidate();   fadeInTickTimer = nil

    voicePlayer?.stop(); voicePlayer = nil
    deltaPlayer?.stop(); deltaPlayer = nil

    isBedtimeSession = false
    isMorningSession = false
    isFadingOut = false
    morningLoopCount = 0

    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: .notifyOthersOnDeactivation
    )
  }

  // MARK: - AVAudioPlayerDelegate

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
    // Fires on the main thread
    guard player === voicePlayer else { return }

    if isBedtimeSession && !isFadingOut {
      // Wait 10 seconds, then replay from the top
      voiceGapTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: false) { [weak self] _ in
        guard let self = self,
              self.isBedtimeSession,
              !self.isFadingOut,
              let p = self.voicePlayer else { return }
        p.currentTime = 0
        p.play()
      }
    } else if isMorningSession {
      morningLoopCount += 1
      if morningLoopCount < 5 {
        // Replay at the same (already-faded-in) volume
        player.currentTime = 0
        player.play()
      } else {
        tearDownAll()
      }
    }
  }

  func audioPlayerDecodeErrorDidOccur(_: AVAudioPlayer, error: Error?) {
    tearDownAll()
  }
}
