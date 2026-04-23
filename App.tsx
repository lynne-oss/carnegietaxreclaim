import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Button, TextInput, Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REC_URI_KEY = '@somni_rec';
const BEDTIME_KEY = '@somni_bed';
const WAKETIME_KEY = '@somni_wake';

const SLEEP_PLAY_MS   = 30 * 60 * 1000; // play for 30 minutes before fading
const SLEEP_FADE_MS   = 60 * 1000;      // fade out over 60 seconds
const SLEEP_FADE_STEP = 500;            // volume step every 500 ms  (120 steps total)
const WAKE_FADE_MS    = 30 * 1000;      // fade in over 30 seconds
const WAKE_FADE_STEP  = 100;            // volume step every 100 ms  (300 steps total)

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [bedtime, setBedtime] = useState('22:00');
  const [waketime, setWaketime] = useState('07:00');
  const [status, setStatus] = useState('Record your sleep audio to begin.');

  const recordingRef  = useRef<Audio.Recording | null>(null);
  const soundRef      = useRef<Audio.Sound | null>(null);
  const genRef        = useRef(0);          // cancel in-flight createAsync on stop
  const sleepTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPlayedRef = useRef('');

  function clearFadeTimers() {
    if (sleepTimer.current)  { clearTimeout(sleepTimer.current);  sleepTimer.current  = null; }
    if (fadeTimer.current)   { clearInterval(fadeTimer.current);  fadeTimer.current   = null; }
  }

  const startLoop = useCallback(async (uri: string, type: 'bedtime' | 'waketime') => {
    const gen = ++genRef.current;
    clearFadeTimers();

    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync().catch(() => {});
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,    // plays even when the mute switch is on
        staysActiveInBackground: true, // keeps playing when the screen locks
      });

      // Wake audio starts silent; sleep audio starts at full volume.
      const startVolume = type === 'waketime' ? 0 : 1;

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, isLooping: true, volume: startVolume },
      );

      if (gen !== genRef.current) {
        await sound.unloadAsync().catch(() => {});
        return;
      }

      soundRef.current = sound;
      setIsPlaying(true);

      if (type === 'waketime') {
        // ── Fade IN: 0 → 1 over WAKE_FADE_MS ────────────────────────────────
        const steps = WAKE_FADE_MS / WAKE_FADE_STEP;
        let step = 0;
        setStatus('Waking gently...');
        fadeTimer.current = setInterval(async () => {
          if (gen !== genRef.current) { clearInterval(fadeTimer.current!); return; }
          step++;
          await soundRef.current?.setVolumeAsync(Math.min(step / steps, 1)).catch(() => {});
          if (step >= steps) {
            clearInterval(fadeTimer.current!);
            fadeTimer.current = null;
            setStatus('Playing on loop...');
          }
        }, WAKE_FADE_STEP);
      } else {
        // ── Sleep: play for SLEEP_PLAY_MS, then fade OUT: 1 → 0 over SLEEP_FADE_MS ──
        setStatus('Playing — fades out after 30 min.');
        sleepTimer.current = setTimeout(() => {
          if (gen !== genRef.current) return;
          setStatus('Fading out...');
          const steps = SLEEP_FADE_MS / SLEEP_FADE_STEP;
          let step = 0;
          fadeTimer.current = setInterval(async () => {
            if (gen !== genRef.current) { clearInterval(fadeTimer.current!); return; }
            step++;
            await soundRef.current?.setVolumeAsync(Math.max(1 - step / steps, 0)).catch(() => {});
            if (step >= steps) {
              clearInterval(fadeTimer.current!);
              fadeTimer.current = null;
              const snd = soundRef.current;
              soundRef.current = null;
              await snd?.stopAsync().catch(() => {});
              await snd?.unloadAsync().catch(() => {});
              setIsPlaying(false);
              setStatus('Faded out. Sleep well.');
            }
          }, SLEEP_FADE_STEP);
        }, SLEEP_PLAY_MS);
      }
    } catch {
      setStatus('Playback error — re-record and try again.');
    }
  }, []);

  async function stopPlayback() {
    genRef.current++;
    clearFadeTimers();
    const snd = soundRef.current;
    soundRef.current = null;
    if (snd) {
      await snd.stopAsync().catch(() => {});
      await snd.unloadAsync().catch(() => {});
    }
    setIsPlaying(false);
    setStatus('Stopped.');
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    (async () => {
      await Audio.requestPermissionsAsync();

      const { granted } = await Notifications.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Notifications disabled',
          'Enable notifications for The Somni in iOS Settings so scheduled playback can trigger.',
        );
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const [savedUri, savedBed, savedWake] = await Promise.all([
        AsyncStorage.getItem(REC_URI_KEY),
        AsyncStorage.getItem(BEDTIME_KEY),
        AsyncStorage.getItem(WAKETIME_KEY),
      ]);

      if (savedUri) {
        setHasRecording(true);
        setStatus('Recording loaded. Ready to schedule.');
      }
      if (savedBed) setBedtime(savedBed);
      if (savedWake) setWaketime(savedWake);

      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      const launchType = lastResponse?.notification.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
      if ((launchType === 'bedtime' || launchType === 'waketime') && savedUri) {
        startLoop(savedUri, launchType);
      }

      timer = setInterval(async () => {
        const now  = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (lastPlayedRef.current === hhmm) return;

        const [uri, bed, wake] = await Promise.all([
          AsyncStorage.getItem(REC_URI_KEY),
          AsyncStorage.getItem(BEDTIME_KEY),
          AsyncStorage.getItem(WAKETIME_KEY),
        ]);

        if (uri && hhmm === bed)  { lastPlayedRef.current = hhmm; startLoop(uri, 'bedtime');  }
        if (uri && hhmm === wake) { lastPlayedRef.current = hhmm; startLoop(uri, 'waketime'); }
      }, 30_000);
    })();

    const onReceive = Notifications.addNotificationReceivedListener(async (notif) => {
      const t = notif.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
      if (t === 'bedtime' || t === 'waketime') {
        const uri = await AsyncStorage.getItem(REC_URI_KEY);
        if (uri) startLoop(uri, t);
      }
    });

    const onResponse = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      const t = resp.notification.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
      if (t === 'bedtime' || t === 'waketime') {
        const uri = await AsyncStorage.getItem(REC_URI_KEY);
        if (uri) startLoop(uri, t);
      }
    });

    return () => {
      clearInterval(timer);
      clearFadeTimers();
      onReceive.remove();
      onResponse.remove();
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, [startLoop]);

  async function toggleRecording() {
    if (isRecording) {
      const rec = recordingRef.current;
      if (!rec) return;
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        recordingRef.current = null;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        if (uri) {
          await AsyncStorage.setItem(REC_URI_KEY, uri);
          setHasRecording(true);
          setStatus('Saved. Set your times below, then tap Schedule.');
        }
      } catch {
        setStatus('Error stopping recording — try again.');
      }
      setIsRecording(false);
    } else {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
        );
        recordingRef.current = recording;
        setIsRecording(true);
        setStatus('Recording...');
      } catch {
        Alert.alert(
          'Microphone error',
          'Could not start recording. Check that microphone permission is granted in iOS Settings.',
        );
      }
    }
  }

  async function schedule() {
    if (!hasRecording) {
      Alert.alert('No recording', 'Record audio first, then schedule.');
      return;
    }

    const [bh, bm] = bedtime.split(':').map(Number);
    const [wh, wm] = waketime.split(':').map(Number);

    if (
      [bh, bm, wh, wm].some(isNaN) ||
      bh > 23 || bm > 59 ||
      wh > 23 || wm > 59
    ) {
      Alert.alert('Invalid time', 'Use 24-hour HH:MM format, e.g. 22:30 or 07:00.');
      return;
    }

    await AsyncStorage.multiSet([
      [BEDTIME_KEY, bedtime],
      [WAKETIME_KEY, waketime],
    ]);

    await Notifications.cancelAllScheduledNotificationsAsync();

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Somni — Sleep',
        body: 'Tap to start your sleep audio.',
        data: { type: 'bedtime' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: bh,
        minute: bm,
      },
    });

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Somni — Wake',
        body: 'Tap to start your wake audio.',
        data: { type: 'waketime' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: wh,
        minute: wm,
      },
    });

    setStatus(`Scheduled — sleep ${bedtime} (fades out after 30 min) · wake ${waketime} (fades in over 30 s)`);

    Alert.alert(
      'Scheduled',
      `Sleep ${bedtime}: plays for 30 min, fades out over 60 s.\n` +
      `Wake ${waketime}: fades in over 30 s.\n\n` +
      'App open → triggers automatically.\n' +
      'App closed → tap the notification.',
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 32 }}>
        The Somni
      </Text>

      <Button
        title={isRecording ? 'Stop Recording' : 'Start Recording'}
        onPress={toggleRecording}
      />

      <Text style={{ marginTop: 32, marginBottom: 4 }}>Sleep time (HH:MM, 24-hour)</Text>
      <TextInput
        value={bedtime}
        onChangeText={setBedtime}
        keyboardType="numbers-and-punctuation"
        style={{ borderWidth: 1, borderColor: '#999', padding: 10, borderRadius: 4 }}
      />

      <Text style={{ marginTop: 16, marginBottom: 4 }}>Wake time (HH:MM, 24-hour)</Text>
      <TextInput
        value={waketime}
        onChangeText={setWaketime}
        keyboardType="numbers-and-punctuation"
        style={{ borderWidth: 1, borderColor: '#999', padding: 10, borderRadius: 4 }}
      />

      <View style={{ marginTop: 24 }}>
        <Button title="Schedule Daily Playback" onPress={schedule} />
      </View>

      <View style={{ marginTop: 16 }}>
        <Button title="Stop Playback" onPress={stopPlayback} />
      </View>

      <Text style={{ marginTop: 32, color: '#666', lineHeight: 22 }}>{status}</Text>
    </View>
  );
}
