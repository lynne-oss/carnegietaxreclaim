import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import Btn from './Btn';
import { C } from './theme';
import { LogEntry, LOG_KEY } from './types';

const SLEEP_PLAY_MS   = 30 * 60 * 1000;
const SLEEP_FADE_MS   = 60 * 1000;
const SLEEP_FADE_STEP = 500;
const WAKE_FADE_MS    = 30 * 1000;
const WAKE_FADE_STEP  = 100;

const REC_URI_KEY  = '@somni_rec';
const BEDTIME_KEY  = '@somni_bed';
const WAKETIME_KEY = '@somni_wake';

const SYSTEM_PROMPT =
  `You are the Somni Decision Engine. Your job is to convert a user's input into a short direct statement they will record in their own voice. This statement represents a decision they have already made not a future intention. Use present tense only. Remove all future tense. Remove vague words like more better improve successful aligned abundant. Do not generate motivational affirmational or inspirational language. Do not invent identity claims. Anchor everything in observable behaviour. Keep output under 2 sentences. Output must be something a person can say naturally without overthinking. Output only the final statement. No explanation. If user input includes abundant manifest universe attract energy alignment remove those concepts completely and translate into behaviour. Return ONLY the final statement. No preamble no explanation no formatting.`;

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-haiku-4-5-20251001';

type SignalPhase = 'input' | 'loading' | 'result' | 'direct';
type Msg = { role: 'user' | 'assistant'; content: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList:   false,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
  }),
});

interface Props {
  onShowLog: () => void;
}

export default function RecordScreen({ onShowLog }: Props) {
  const [isRecording,   setIsRecording]   = useState(false);
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [isWakePlaying, setIsWakePlaying] = useState(false);
  const [hasRecording,  setHasRecording]  = useState(false);
  const [bedtime,       setBedtime]       = useState('22:00');
  const [waketime,      setWaketime]      = useState('07:00');
  const [status,        setStatus]        = useState('Record your sleep audio to begin.');

  const [signalPhase,   setSignalPhase]   = useState<SignalPhase>('input');
  const [ans1,          setAns1]          = useState('');
  const [ans2,          setAns2]          = useState('');
  const [ans3,          setAns3]          = useState('');
  const [statement,     setStatement]     = useState('');
  const [signalHistory, setSignalHistory] = useState<Msg[]>([]);

  const recordingRef  = useRef<Audio.Recording | null>(null);
  const soundRef      = useRef<Audio.Sound | null>(null);
  const genRef        = useRef(0);
  const sleepTimer    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const fadeTimer     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPlayedRef = useRef('');
  const isFading      = useRef(false);

  function clearFadeTimers() {
    if (sleepTimer.current) { clearTimeout(sleepTimer.current);  sleepTimer.current = null; }
    if (fadeTimer.current)  { clearInterval(fadeTimer.current);  fadeTimer.current  = null; }
  }

  const startLoop = useCallback(async (uri: string, type: 'bedtime' | 'waketime') => {
    const gen = ++genRef.current;
    isFading.current = false;
    clearFadeTimers();
    try {
      if (soundRef.current) {
        soundRef.current.setOnPlaybackStatusUpdate(null);
        await soundRef.current.stopAsync().catch(() => {});
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      const info = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false } as FileSystem.FileInfo));
      if (!info.exists) {
        setStatus('Recording not found — please re-record your intention.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      const startVolume = type === 'waketime' ? 0 : 1;
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, isLooping: false, volume: startVolume },
      );
      if (gen !== genRef.current) { await sound.unloadAsync().catch(() => {}); return; }
      soundRef.current = sound;
      setIsPlaying(true);
      if (type === 'waketime') setIsWakePlaying(true);

      // Manual loop: play → 10 s silence → play → repeat
      sound.setOnPlaybackStatusUpdate((ps) => {
        if (!ps.isLoaded || !ps.didJustFinish) return;
        if (gen !== genRef.current || isFading.current) return;
        setTimeout(async () => {
          if (gen !== genRef.current || isFading.current) return;
          await soundRef.current?.replayAsync().catch(() => {});
        }, 10_000);
      });

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
          isFading.current = true;
          const steps = SLEEP_FADE_MS / SLEEP_FADE_STEP;
          let step = 0;
          fadeTimer.current = setInterval(async () => {
            if (gen !== genRef.current) { clearInterval(fadeTimer.current!); return; }
            step++;
            await soundRef.current?.setVolumeAsync(Math.max(1 - step / steps, 0)).catch(() => {});
            if (step >= steps) {
              clearInterval(fadeTimer.current!); fadeTimer.current = null;
              const snd = soundRef.current; soundRef.current = null;
              snd?.setOnPlaybackStatusUpdate(null);
              await snd?.stopAsync().catch(() => {}); await snd?.unloadAsync().catch(() => {});
              isFading.current = false;
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
    isFading.current = false;
    clearFadeTimers();
    const snd = soundRef.current; soundRef.current = null;
    if (snd) {
      snd.setOnPlaybackStatusUpdate(null);
      await snd.stopAsync().catch(() => {});
      await snd.unloadAsync().catch(() => {});
    }
    setIsPlaying(false);
    setIsWakePlaying(false);
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
        if (uri) {
          const dest = `${FileSystem.documentDirectory}somni_recording.m4a`;
          await FileSystem.copyAsync({ from: uri, to: dest });
          await AsyncStorage.setItem(REC_URI_KEY, dest);
          setHasRecording(true);
          setStatus('Saved. Set your times above, then tap Schedule.');
          const entry: LogEntry = { id: Date.now().toString(), timestamp: Date.now(), text: statement };
          const raw = await AsyncStorage.getItem(LOG_KEY).catch(() => null);
          const existing: LogEntry[] = raw ? JSON.parse(raw) : [];
          await AsyncStorage.setItem(LOG_KEY, JSON.stringify([entry, ...existing])).catch(() => {});
        }
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

  async function callClaude(msgs: Msg[]) {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
    if (!apiKey) {
      Alert.alert(
        'API key missing',
        'Create a .env file in the project root with:\n\nEXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...\n\nThen restart Expo with --clear.',
      );
      return;
    }
    setSignalPhase('loading');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 150, system: SYSTEM_PROMPT, messages: msgs }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = (data.content[0].text as string).trim();
      const updated: Msg[] = [...msgs, { role: 'assistant', content: text }];
      setSignalHistory(updated);
      setStatement(text);
      setSignalPhase('result');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Check your connection and try again.');
      setSignalPhase('input');
    }
  }

  function handleGenerate() {
    const a1 = ans1.trim(), a2 = ans2.trim(), a3 = ans3.trim();
    if (!a1 || !a2 || !a3) { Alert.alert('', 'Please answer all three questions before generating.'); return; }
    const content =
      `What I'm working on or moving towards: ${a1}\n\nWhat keeps getting in the way: ${a2}\n\nWhat it would look like if that wasn't an issue: ${a3}`;
    callClaude([{ role: 'user', content }]);
  }

  function handleSimplify() {
    callClaude([...signalHistory, {
      role: 'user',
      content: 'Simplify further. Shorter. More direct. Higher certainty. Under one sentence.',
    }]);
  }

  function handleTryAgain() {
    setSignalPhase('input');
    setStatement('');
    setSignalHistory([]);
    setAns1(''); setAns2(''); setAns3('');
  }

  const recordLabel = isRecording
    ? 'Stop Recording'
    : signalPhase === 'result' ? 'Record in your voice' : 'Start Recording';

  // ── Wake mode: cream screen ───────────────────────────────────────────────────
  if (isWakePlaying) {
    return (
      <SafeAreaView style={s.wakeRoot}>
        <StatusBar style="dark" />
        <View style={s.wakeInner}>
          <Text style={s.wakeTitle}>The Somni</Text>
          <View style={s.wakeRule} />
          <Text style={s.wakeStatus}>{status}</Text>
          <View style={{ marginTop: 48 }}>
            <Btn label="Stop" onPress={stopPlayback} dark />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Normal dark screen ────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.inner}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.headerRow}>
            <Text style={s.title}>The Somni</Text>
            <TouchableOpacity onPress={onShowLog} activeOpacity={0.6} style={s.logLinkWrap}>
              <Text style={s.logLink}>Log</Text>
            </TouchableOpacity>
          </View>
          <View style={s.rule} />

          {/* ── Record ── */}
          {signalPhase === 'result' && (
            <>
              <Text style={s.resultLabel}>Your signal</Text>
              <Text style={s.resultStatement}>{'"'}{statement}{'"'}</Text>
              <View style={{ height: 24 }} />
            </>
          )}
          <Btn label={recordLabel} onPress={toggleRecording} />

          {/* ── Schedule ── */}
          <Text style={[s.label, { marginTop: 32 }]}>Sleep time</Text>
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

          <View style={{ marginTop: 32 }}>
            <Btn label="Schedule Daily Playback" onPress={schedule} />
          </View>
          <View style={{ marginTop: 12 }}>
            <Btn label="Stop Playback" onPress={stopPlayback} />
          </View>

          <Text style={s.status}>{status}</Text>

          {/* ── Before You Record ── */}
          <View style={s.sectionRule} />
          <Text style={s.sectionHeading}>Before You Record</Text>

          {signalPhase === 'loading' && (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={C.primary} size="small" />
              <Text style={s.loadingText}>Finding your signal...</Text>
            </View>
          )}

          {signalPhase === 'input' && (
            <>
              <Text style={s.label}>What are you working on or moving towards right now?</Text>
              <TextInput
                value={ans1}
                onChangeText={setAns1}
                multiline
                style={s.signalInput}
                placeholderTextColor={C.secondary}
                placeholder="I'm moving towards…"
              />

              <Text style={[s.label, { marginTop: 24 }]}>What keeps getting in the way?</Text>
              <TextInput
                value={ans2}
                onChangeText={setAns2}
                multiline
                style={s.signalInput}
                placeholderTextColor={C.secondary}
                placeholder="What gets in the way is…"
              />

              <Text style={[s.label, { marginTop: 24 }]}>What would it look like if that wasn't an issue?</Text>
              <TextInput
                value={ans3}
                onChangeText={setAns3}
                multiline
                style={s.signalInput}
                placeholderTextColor={C.secondary}
                placeholder="It would look like…"
              />

              <View style={{ marginTop: 28 }}>
                <Btn label="Generate" onPress={handleGenerate} />
              </View>
              <TouchableOpacity onPress={() => setSignalPhase('direct')} style={s.skipWrap} activeOpacity={0.6}>
                <Text style={s.skip}>Already know what to say? Record directly.</Text>
              </TouchableOpacity>
            </>
          )}

          {signalPhase === 'result' && (
            <>
              <View style={{ marginTop: 4 }}>
                <Btn label="Make it simpler" onPress={handleSimplify} />
              </View>
              <View style={{ marginTop: 12 }}>
                <Btn label="Try again" onPress={handleTryAgain} />
              </View>
            </>
          )}

          {signalPhase === 'direct' && (
            <TouchableOpacity onPress={() => setSignalPhase('input')} style={s.skipWrap} activeOpacity={0.6}>
              <Text style={s.skip}>Answer the questions to generate a statement instead.</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0B0D',
  },
  inner: {
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 60,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'CormorantGaramond_300Light',
    fontWeight: '300',
    fontSize: 42,
    color: C.primary,
    letterSpacing: 2,
  },
  logLinkWrap: {
    paddingBottom: 6,
  },
  logLink: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 11,
    color: C.secondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textDecorationLine: 'underline',
  },
  rule: {
    height: 1,
    backgroundColor: C.border,
    marginBottom: 36,
  },
  sectionRule: {
    height: 1,
    backgroundColor: C.border,
    marginTop: 48,
    marginBottom: 32,
  },
  sectionHeading: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 11,
    color: C.secondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 28,
  },
  label: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 11,
    color: C.secondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 18,
    color: C.primary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: C.inputBg,
  },
  signalInput: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 18,
    color: C.primary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: C.inputBg,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  skipWrap: {
    marginTop: 28,
    alignItems: 'center',
  },
  skip: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 13,
    color: C.secondary,
    textDecorationLine: 'underline',
  },
  loadingWrap: {
    marginTop: 40,
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 14,
    color: C.secondary,
    letterSpacing: 1,
  },
  resultLabel: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 11,
    color: C.secondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  resultStatement: {
    fontFamily: 'CormorantGaramond_300Light',
    fontWeight: '300',
    fontSize: 26,
    color: C.primary,
    lineHeight: 38,
    letterSpacing: 0.5,
  },
  status: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 13,
    color: C.secondary,
    lineHeight: 22,
    marginTop: 36,
  },
  // ── Wake mode ──
  wakeRoot: {
    flex: 1,
    backgroundColor: '#F5F1EB',
  },
  wakeInner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wakeTitle: {
    fontFamily: 'CormorantGaramond_300Light',
    fontWeight: '300',
    fontSize: 42,
    color: '#0B0B0D',
    letterSpacing: 2,
    marginBottom: 20,
  },
  wakeRule: {
    width: '100%',
    height: 1,
    backgroundColor: '#D8D2C8',
    marginBottom: 40,
  },
  wakeStatus: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 13,
    color: '#7A7068',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});
