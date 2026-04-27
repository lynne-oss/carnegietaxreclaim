import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  SafeAreaView, StyleSheet, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { CormorantGaramond_300Light } from '@expo-google-fonts/cormorant-garamond';
import { Inter_300Light } from '@expo-google-fonts/inter';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:        '#0B0B0D',
  primary:   '#E6E2DA',
  secondary: '#A3A3A3',
  accent:    '#1F3A33',
  border:    '#2A2E2C',
} as const;

// ── Timing constants ──────────────────────────────────────────────────────────
const SLEEP_PLAY_MS   = 30 * 60 * 1000;
const SLEEP_FADE_MS   = 60 * 1000;
const SLEEP_FADE_STEP = 500;
const WAKE_FADE_MS    = 30 * 1000;
const WAKE_FADE_STEP  = 100;

// ── Storage keys ──────────────────────────────────────────────────────────────
const REC_URI_KEY  = '@somni_rec';
const BEDTIME_KEY  = '@somni_bed';
const WAKETIME_KEY = '@somni_wake';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList:   false,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
  }),
});

export default function App() {
  const [fontsLoaded] = useFonts({ CormorantGaramond_300Light, Inter_300Light });

  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [bedtime,  setBedtime]  = useState('22:00');
  const [waketime, setWaketime] = useState('07:00');
  const [status, setStatus] = useState('Record your sleep audio to begin.');

  const recordingRef  = useRef<Audio.Recording | null>(null);
  const soundRef      = useRef<Audio.Sound | null>(null);
  const genRef        = useRef(0);
  const sleepTimer    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const fadeTimer     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPlayedRef = useRef('');

  function clearFadeTimers() {
    if (sleepTimer.current) { clearTimeout(sleepTimer.current);  sleepTimer.current = null; }
    if (fadeTimer.current)  { clearInterval(fadeTimer.current);  fadeTimer.current  = null; }
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
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      const startVolume = type === 'waketime' ? 0 : 1;
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, isLooping: true, volume: startVolume },
      );
      if (gen !== genRef.current) { await sound.unloadAsync().catch(() => {}); return; }
      soundRef.current = sound;
      setIsPlaying(true);

      if (type === 'waketime') {
        const steps = WAKE_FADE_MS / WAKE_FADE_STEP;
        let step = 0;
        setStatus('Waking gently...');
        fadeTimer.current = setInterval(async () => {
          if (gen !== genRef.current) { clearInterval(fadeTimer.current!); return; }
          step++;
          await soundRef.current?.setVolumeAsync(Math.min(step / steps, 1)).catch(() => {});
          if (step >= steps) { clearInterval(fadeTimer.current!); fadeTimer.current = null; setStatus('Playing on loop...'); }
        }, WAKE_FADE_STEP);
      } else {
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
              clearInterval(fadeTimer.current!); fadeTimer.current = null;
              const snd = soundRef.current; soundRef.current = null;
              await snd?.stopAsync().catch(() => {}); await snd?.unloadAsync().catch(() => {});
              setIsPlaying(false); setStatus('Faded out. Sleep well.');
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
    const snd = soundRef.current; soundRef.current = null;
    if (snd) { await snd.stopAsync().catch(() => {}); await snd.unloadAsync().catch(() => {}); }
    setIsPlaying(false);
    setStatus('Stopped.');
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    (async () => {
      await Audio.requestPermissionsAsync();
      const { granted } = await Notifications.requestPermissionsAsync();
      if (!granted) Alert.alert('Notifications disabled', 'Enable notifications for The Somni in iOS Settings.');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: true });
      const [savedUri, savedBed, savedWake] = await Promise.all([
        AsyncStorage.getItem(REC_URI_KEY), AsyncStorage.getItem(BEDTIME_KEY), AsyncStorage.getItem(WAKETIME_KEY),
      ]);
      if (savedUri) { setHasRecording(true); setStatus('Recording loaded. Ready to schedule.'); }
      if (savedBed)  setBedtime(savedBed);
      if (savedWake) setWaketime(savedWake);
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      const launchType = lastResponse?.notification.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
      if ((launchType === 'bedtime' || launchType === 'waketime') && savedUri) startLoop(savedUri, launchType);
      timer = setInterval(async () => {
        const now  = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (lastPlayedRef.current === hhmm) return;
        const [uri, bed, wake] = await Promise.all([
          AsyncStorage.getItem(REC_URI_KEY), AsyncStorage.getItem(BEDTIME_KEY), AsyncStorage.getItem(WAKETIME_KEY),
        ]);
        if (uri && hhmm === bed)  { lastPlayedRef.current = hhmm; startLoop(uri, 'bedtime');  }
        if (uri && hhmm === wake) { lastPlayedRef.current = hhmm; startLoop(uri, 'waketime'); }
      }, 30_000);
    })();
    const onReceive = Notifications.addNotificationReceivedListener(async (notif) => {
      const t = notif.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
      if (t === 'bedtime' || t === 'waketime') { const uri = await AsyncStorage.getItem(REC_URI_KEY); if (uri) startLoop(uri, t); }
    });
    const onResponse = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      const t = resp.notification.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
      if (t === 'bedtime' || t === 'waketime') { const uri = await AsyncStorage.getItem(REC_URI_KEY); if (uri) startLoop(uri, t); }
    });
    return () => { clearInterval(timer); clearFadeTimers(); onReceive.remove(); onResponse.remove(); soundRef.current?.unloadAsync().catch(() => {}); };
  }, [startLoop]);

  async function toggleRecording() {
    if (isRecording) {
      const rec = recordingRef.current; if (!rec) return;
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI(); recordingRef.current = null;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        if (uri) { await AsyncStorage.setItem(REC_URI_KEY, uri); setHasRecording(true); setStatus('Saved. Set your times below, then tap Schedule.'); }
      } catch { setStatus('Error stopping recording — try again.'); }
      setIsRecording(false);
    } else {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recordingRef.current = recording; setIsRecording(true); setStatus('Recording...');
      } catch { Alert.alert('Microphone error', 'Could not start recording. Check microphone permission in iOS Settings.'); }
    }
  }

  async function schedule() {
    if (!hasRecording) { Alert.alert('No recording', 'Record audio first, then schedule.'); return; }
    const [bh, bm] = bedtime.split(':').map(Number);
    const [wh, wm] = waketime.split(':').map(Number);
    if ([bh, bm, wh, wm].some(isNaN) || bh > 23 || bm > 59 || wh > 23 || wm > 59) {
      Alert.alert('Invalid time', 'Use 24-hour HH:MM format, e.g. 22:30 or 07:00.'); return;
    }
    await AsyncStorage.multiSet([[BEDTIME_KEY, bedtime], [WAKETIME_KEY, waketime]]);
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Somni — Sleep', body: 'Tap to start your sleep audio.', data: { type: 'bedtime' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: bh, minute: bm },
    });
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Somni — Wake', body: 'Tap to start your wake audio.', data: { type: 'waketime' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: wh, minute: wm },
    });
    setStatus(`Sleep ${bedtime} · Wake ${waketime}`);
    Alert.alert('Scheduled', `Sleep ${bedtime}: plays 30 min then fades out.\nWake ${waketime}: fades in over 30 s.`);
  }

  // Keep the dark background visible while fonts load.
  if (!fontsLoaded) return <View style={s.root} />;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <View style={s.inner}>

        {/* ── Title ── */}
        <Text style={s.title}>The Somni</Text>
        <View style={s.rule} />

        {/* ── Record ── */}
        <Btn
          label={isRecording ? 'Stop Recording' : 'Start Recording'}
          onPress={toggleRecording}
          variant={isRecording ? 'recording' : 'primary'}
        />

        {/* ── Times ── */}
        <Text style={s.label}>Sleep time</Text>
        <TextInput
          value={bedtime}
          onChangeText={setBedtime}
          keyboardType="numbers-and-punctuation"
          placeholderTextColor={C.secondary}
          style={s.input}
        />

        <Text style={[s.label, { marginTop: 20 }]}>Wake time</Text>
        <TextInput
          value={waketime}
          onChangeText={setWaketime}
          keyboardType="numbers-and-punctuation"
          placeholderTextColor={C.secondary}
          style={s.input}
        />

        {/* ── Actions ── */}
        <View style={{ marginTop: 32 }}>
          <Btn label="Schedule Daily Playback" onPress={schedule} variant="primary" />
        </View>
        <View style={{ marginTop: 12 }}>
          <Btn label="Stop Playback" onPress={stopPlayback} variant="ghost" />
        </View>

        {/* ── Status ── */}
        <Text style={s.status}>{status}</Text>
      </View>
    </SafeAreaView>
  );
}

// ── Reusable button ────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'ghost' | 'recording';

function Btn({ label, onPress, variant = 'primary' }: { label: string; onPress: () => void; variant?: BtnVariant }) {
  const bg     = variant === 'primary'   ? C.accent
               : variant === 'recording' ? '#3B1515'
               : 'transparent';
  const border = variant === 'ghost' ? C.border : 'transparent';
  const color  = variant === 'recording' ? '#E8A0A0' : C.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[s.btn, { backgroundColor: bg, borderColor: border, borderWidth: variant === 'ghost' ? 1 : 0 }]}
    >
      <Text style={[s.btnText, { color }]}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 32,
  },
  title: {
    fontFamily: 'CormorantGaramond_300Light',
    fontSize: 42,
    color: C.primary,
    letterSpacing: 2,
    marginBottom: 20,
  },
  rule: {
    height: 1,
    backgroundColor: C.border,
    marginBottom: 36,
  },
  label: {
    fontFamily: 'Inter_300Light',
    fontSize: 11,
    color: C.secondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    fontFamily: 'Inter_300Light',
    fontSize: 18,
    color: C.primary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#111214',
  },
  btn: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 2,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: 'Inter_300Light',
    fontSize: 11,
    letterSpacing: 2.5,
  },
  status: {
    fontFamily: 'Inter_300Light',
    fontSize: 13,
    color: C.secondary,
    lineHeight: 22,
    marginTop: 36,
  },
});
