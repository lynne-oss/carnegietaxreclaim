import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, AppState,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  useAudioPlayer,
  useAudioRecorder,
  useAudioPlayerStatus,
  useAudioRecorderState,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
} from 'expo-audio';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File as EXFile, Paths } from 'expo-file-system';
import Btn from './Btn';
import { C } from './theme';
import { LogEntry, LOG_KEY } from './types';

const SLEEP_PLAY_MS   = 20 * 60 * 1000;
const SLEEP_FADE_MS   = 10 * 60 * 1000;
const SLEEP_FADE_STEP = 500;
const GAP_BETWEEN_LOOPS_MS = 10_000;
const WAKE_LOOPS = 5;
const WAKE_FADE_MS = 30_000;
const WAKE_TARGET_VOL = 0.7;

const REC_URI_KEY  = '@somni_rec';
const BEDTIME_KEY  = '@somni_bed';
const WAKETIME_KEY  = '@somni_wake';
const STATEMENT_KEY = '@somni_statement';

const NETLIFY_URL = 'https://thesomni.app/.netlify/functions/generate-intention';

type SignalPhase = 'input' | 'loading' | 'result' | 'direct';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isWake = notification.request.content.data?.type === 'waketime';
    return {
      shouldShowBanner: isWake,
      shouldShowList:   isWake,
      shouldPlaySound:  isWake,
      shouldSetBadge:   false,
    };
  },
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
  const [statement,     setStatement]     = useState('');
  const [wakeStatement, setWakeStatement] = useState('');

  const recorder      = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const player        = useAudioPlayer(null, { keepAudioSessionActive: true, updateInterval: 60_000 });
  const playerStatus  = useAudioPlayerStatus(player);
  // Delta binaural track — downloadFirst ensures a local file:// URI is used even on first load,
  // preventing background HTTP fetches (which iOS blocks with screen locked).
  const deltaPlayer   = useAudioPlayer(require('./assets/audio/delta.mp3'), { keepAudioSessionActive: true, updateInterval: 30_000, downloadFirst: true });

  const genRef           = useRef(0);
  const sleepTimer       = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const fadeTimer        = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPlayedRef    = useRef('');
  const isFading         = useRef(false);
  const isWakePlayingRef = useRef(false);
  const loopTypeRef      = useRef<'bedtime' | 'waketime' | null>(null);
  const wakeLoopCountRef = useRef(0);

  function clearFadeTimers() {
    if (sleepTimer.current) { clearTimeout(sleepTimer.current);  sleepTimer.current = null; }
    if (fadeTimer.current)  { clearInterval(fadeTimer.current);  fadeTimer.current  = null; }
  }

  const startLoop = useCallback(async (uri: string, type: 'bedtime' | 'waketime') => {
    const gen = ++genRef.current;
    isFading.current = false;
    clearFadeTimers();
    loopTypeRef.current = null;
    try {
      player.loop = false;
      player.pause();
      if (!new EXFile(uri).exists) {
        setStatus('Recording not found — please re-record your intention.');
        return;
      }
      const modeArgs = { allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' as const };
      console.log('[Somni] setAudioModeAsync:', JSON.stringify(modeArgs));
      await setAudioModeAsync(modeArgs);
      if (gen !== genRef.current) return;
      player.replace({ uri });
      player.loop = false;
      loopTypeRef.current = type;
      if (type === 'waketime') {
        // Morning: fade in from 0 to 0.7 over 30 s, then play remaining loops at 0.7
        wakeLoopCountRef.current = 0;
        player.volume = 0;
        player.play();
        setIsPlaying(true);
        setIsWakePlaying(true);
        isWakePlayingRef.current = true;
        setStatus('Good morning.');
        const fadeSteps = WAKE_FADE_MS / SLEEP_FADE_STEP;
        let fadeStep = 0;
        fadeTimer.current = setInterval(() => {
          if (gen !== genRef.current) { clearInterval(fadeTimer.current!); return; }
          fadeStep++;
          player.volume = Math.min((WAKE_TARGET_VOL * fadeStep) / fadeSteps, WAKE_TARGET_VOL);
          if (fadeStep >= fadeSteps) {
            clearInterval(fadeTimer.current!);
            fadeTimer.current = null;
          }
        }, SLEEP_FADE_STEP);
      } else {
        // Night: delta + intention together, both fade and stop at 30 min
        player.volume = 1;
        deltaPlayer.volume = 0.3;
        deltaPlayer.loop = true;
        deltaPlayer.play();
        player.play();
        setIsPlaying(true);
        setStatus('Playing — fades out from 20 min, silent at 30 min.');
        sleepTimer.current = setTimeout(() => {
          if (gen !== genRef.current) return;
          setStatus('Fading out...');
          isFading.current = true;
          const steps = SLEEP_FADE_MS / SLEEP_FADE_STEP;
          let step = 0;
          fadeTimer.current = setInterval(() => {
            if (gen !== genRef.current) { clearInterval(fadeTimer.current!); return; }
            step++;
            player.volume = Math.max(1 - step / steps, 0);
            deltaPlayer.volume = Math.max(0.3 * (1 - step / steps), 0);
            if (step >= steps) {
              clearInterval(fadeTimer.current!); fadeTimer.current = null;
              loopTypeRef.current = null;
              player.loop = false;
              player.pause();
              deltaPlayer.loop = false;
              deltaPlayer.pause();
              isFading.current = false;
              setIsPlaying(false);
              setStatus('Session complete.');
            }
          }, SLEEP_FADE_STEP);
        }, SLEEP_PLAY_MS);
      }
    } catch {
      setStatus('Playback error — re-record and try again.');
    }
  }, [player, deltaPlayer]);

  async function stopPlayback() {
    console.log('[Somni] stopPlayback called');
    genRef.current++;
    isFading.current = false;
    clearFadeTimers();
    loopTypeRef.current = null;
    player.loop = false;
    player.pause();
    deltaPlayer.loop = false;
    deltaPlayer.pause();
    setIsPlaying(false);
    setIsWakePlaying(false);
    isWakePlayingRef.current = false;
    setStatus('Stopped.');
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const mounted = { current: true };
    (async () => {
      try {
        await requestRecordingPermissionsAsync();
        const { granted } = await Notifications.requestPermissionsAsync();
        if (!mounted.current) return;
        if (!granted) Alert.alert('Notifications disabled', 'Enable notifications for The Somni in iOS Settings.');
        const initMode = { allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' as const };
        console.log('[Somni] setAudioModeAsync (mount init):', JSON.stringify(initMode));
        await setAudioModeAsync(initMode);
        const [savedUri, savedBed, savedWake, savedStatement] = await Promise.all([
          AsyncStorage.getItem(REC_URI_KEY), AsyncStorage.getItem(BEDTIME_KEY), AsyncStorage.getItem(WAKETIME_KEY), AsyncStorage.getItem(STATEMENT_KEY),
        ]);
        if (!mounted.current) return;
        if (savedUri) { setHasRecording(true); setStatus('Recording loaded. Ready to schedule.'); }
        if (savedBed)       setBedtime(savedBed);
        if (savedWake)      setWaketime(savedWake);
        if (savedStatement) setWakeStatement(savedStatement);
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (!mounted.current) return;
        const launchType = lastResponse?.notification.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
        if ((launchType === 'bedtime' || launchType === 'waketime') && savedUri) startLoop(savedUri, launchType);
        timer = setInterval(async () => {
          if (!mounted.current) return;
          try {
            const now  = new Date();
            const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            if (lastPlayedRef.current === hhmm) return;
            const [uri, bed, wake] = await Promise.all([
              AsyncStorage.getItem(REC_URI_KEY), AsyncStorage.getItem(BEDTIME_KEY), AsyncStorage.getItem(WAKETIME_KEY),
            ]);
            if (!mounted.current) return;
            if (uri && hhmm === bed) { lastPlayedRef.current = hhmm; startLoop(uri, 'bedtime'); }
            if (uri && hhmm === wake && !isWakePlayingRef.current) { lastPlayedRef.current = hhmm; startLoop(uri, 'waketime'); }
          } catch {}
        }, 60_000);
      } catch {}
    })();
    const onReceive = Notifications.addNotificationReceivedListener(async (notif) => {
      try {
        const t = notif.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
        if (t === 'bedtime') { const uri = await AsyncStorage.getItem(REC_URI_KEY); if (uri) startLoop(uri, t); }
        if (t === 'waketime' && !isWakePlayingRef.current) { const uri = await AsyncStorage.getItem(REC_URI_KEY); if (uri) startLoop(uri, t); }
      } catch {}
    });
    const onResponse = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      try {
        const t = resp.notification.request.content.data?.type as 'bedtime' | 'waketime' | undefined;
        if (t === 'bedtime') { const uri = await AsyncStorage.getItem(REC_URI_KEY); if (uri) startLoop(uri, t); }
        if (t === 'waketime' && !isWakePlayingRef.current) { const uri = await AsyncStorage.getItem(REC_URI_KEY); if (uri) startLoop(uri, t); }
      } catch {}
    });
    const appStateSub = AppState.addEventListener('change', (state) => {
      console.log('[Somni] AppState ->', state, '| loopType:', loopTypeRef.current, '| wakeLoop:', wakeLoopCountRef.current, '| waking:', isWakePlayingRef.current);
    });
    return () => { mounted.current = false; clearInterval(timer); clearFadeTimers(); onReceive.remove(); onResponse.remove(); appStateSub.remove(); };
  }, [startLoop]);

  // Handle intention track finishing
  useEffect(() => {
    if (!playerStatus.didJustFinish) return;
    if (loopTypeRef.current === 'bedtime') {
      // 10 s gap then restart
      const gen = genRef.current;
      const t = setTimeout(async () => {
        if (gen !== genRef.current) return;
        try {
          await player.seekTo(0);
          if (gen !== genRef.current) return;
          player.play();
        } catch (e) { console.log('[Somni] gap restart error:', e); }
      }, GAP_BETWEEN_LOOPS_MS);
      return () => clearTimeout(t);
    }
    if (loopTypeRef.current === 'waketime') {
      wakeLoopCountRef.current++;
      if (wakeLoopCountRef.current < WAKE_LOOPS) {
        // More loops remaining — 10 s gap then play again
        const gen = genRef.current;
        const t = setTimeout(async () => {
          if (gen !== genRef.current) return;
          try {
            await player.seekTo(0);
            if (gen !== genRef.current) return;
            player.play();
          } catch (e) { console.log('[Somni] gap restart error:', e); }
        }, GAP_BETWEEN_LOOPS_MS);
        return () => clearTimeout(t);
      } else {
        // All 5 loops complete — stop and return to main screen
        genRef.current++;
        loopTypeRef.current = null;
        setIsPlaying(false);
        setIsWakePlaying(false);
        isWakePlayingRef.current = false;
        setStatus('Good morning.');
      }
    }
  }, [playerStatus.didJustFinish, player]);

  async function toggleRecording() {
    if (isRecording) {
      setIsRecording(false);
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) {
          Alert.alert('Recording failed', 'No audio file was produced. Please try again.');
          setStatus('Recording failed — no file produced.');
          return;
        }
        const destFile = new EXFile(Paths.document, 'somni_recording.m4a');
        if (destFile.exists) destFile.delete();
        new EXFile(uri).copy(destFile);
        await AsyncStorage.setItem(REC_URI_KEY, destFile.uri);
        await AsyncStorage.setItem(STATEMENT_KEY, statement).catch(() => {});
        setWakeStatement(statement);
        setHasRecording(true);
        setStatus('Saved. Set your times above, then tap Schedule.');
        const entry: LogEntry = { id: Date.now().toString(), timestamp: Date.now(), text: statement };
        const raw = await AsyncStorage.getItem(LOG_KEY).catch(() => null);
        const existing: LogEntry[] = raw ? JSON.parse(raw) : [];
        await AsyncStorage.setItem(LOG_KEY, JSON.stringify([entry, ...existing])).catch(() => {});
      } catch (e: any) {
        const msg = e?.message ?? String(e) ?? 'Unknown error';
        Alert.alert('Save failed', msg);
        setStatus(`Save error: ${msg}`);
      } finally {
        const afterRecMode = { allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' as const };
        console.log('[Somni] setAudioModeAsync (toggleRecording finally):', JSON.stringify(afterRecMode));
        setAudioModeAsync(afterRecMode).catch(() => {});
      }
    } else {
      try {
        setStatus('Checking microphone permission...');
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          Alert.alert('Microphone access required', 'Go to iOS Settings → Privacy & Security → Microphone and enable The Somni.');
          setStatus('Microphone permission not granted.');
          return;
        }
        setStatus('Configuring audio session...');
        const recMode = { allowsRecording: true, playsInSilentMode: true };
        console.log('[Somni] setAudioModeAsync (start recording):', JSON.stringify(recMode));
        await setAudioModeAsync(recMode);
        setStatus('Preparing recorder...');
        await recorder.prepareToRecordAsync();
        setStatus('Starting...');
        recorder.record();
        setIsRecording(true);
        setStatus('Recording...');
      } catch (e: any) {
        const msg = (e?.message ?? String(e)) || 'Unknown error';
        Alert.alert('Recording failed', msg);
        setStatus(`Recording error: ${msg}`);
      }
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
      content: { title: 'Somni — Wake', body: 'Tap to start your wake audio.', sound: 'default', data: { type: 'waketime' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: wh, minute: wm },
    });
    setStatus(`Sleep ${bedtime} · Wake ${waketime}`);
    Alert.alert('Scheduled', `Sleep ${bedtime}: intention + delta play for 20 min, both fade out by 30 min.\nMorning ${waketime}: tap the notification — plays 5 times then stops.`);
  }

  async function callNetlify(a1: string, a2: string) {
    setSignalPhase('loading');
    try {
      const res = await fetch(NETLIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ans1: a1, ans2: a2 }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const intention = (data.intention as string).trim();
      setStatement(intention);
      setSignalPhase('result');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Check your connection and try again.');
      setSignalPhase('input');
    }
  }

  function handleGenerate() {
    const a1 = ans1.trim();
    const a2 = ans2.trim();
    if (!a1 || !a2) { Alert.alert('', 'Please fill in both fields before generating.'); return; }
    callNetlify(a1, a2);
  }

  function handleSimplify() {
    callNetlify(ans1.trim(), ans2.trim());
  }

  function handleTryAgain() {
    setSignalPhase('input');
    setStatement('');
    setAns1('');
    setAns2('');
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
          {!!wakeStatement && (
            <Text style={s.wakeStatement}>{wakeStatement}</Text>
          )}
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

          {/* ── Before You Record ── */}
          <Text style={s.sectionHeading}>Before You Record</Text>

          {signalPhase === 'loading' && (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={C.primary} size="small" />
              <Text style={s.loadingText}>Finding your signal...</Text>
            </View>
          )}

          {signalPhase === 'input' && (
            <>
              <Text style={s.label}>What are you committed to right now</Text>
              <TextInput
                value={ans1}
                onChangeText={setAns1}
                multiline
                style={s.signalInput}
                placeholderTextColor={C.secondary}
                placeholder="..."
              />
              <Text style={[s.label, { marginTop: 24 }]}>What usually pulls you off it</Text>
              <TextInput
                value={ans2}
                onChangeText={setAns2}
                multiline
                style={s.signalInput}
                placeholderTextColor={C.secondary}
                placeholder="..."
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
              <Text style={s.resultLabel}>Your signal</Text>
              <Text style={s.resultStatement}>{'"'}{statement}{'"'}</Text>
              <View style={{ marginTop: 20 }}>
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

          {/* ── Record ── */}
          <View style={s.sectionRule} />
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

          <Text style={s.status}>
            {isRecording && (recorderState.durationMillis ?? 0) > 0
              ? `Recording... ${Math.floor((recorderState.durationMillis ?? 0) / 1000)}s`
              : status}
          </Text>

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
    marginTop: 36,
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
    letterSpacing: 1,
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
  wakeStatement: {
    fontFamily: 'CormorantGaramond_300Light',
    fontWeight: '300',
    fontSize: 26,
    color: '#0B0B0D',
    lineHeight: 38,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
