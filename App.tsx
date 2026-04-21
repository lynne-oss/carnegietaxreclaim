import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Button, TextInput, Alert } from 'react-native';
import {
  useAudioRecorder,
  createAudioPlayer,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
  type AudioPlayer,
} from 'expo-audio';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REC_URI_KEY = '@somni_rec';
const BEDTIME_KEY = '@somni_bed';
const WAKETIME_KEY = '@somni_wake';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [bedtime, setBedtime] = useState('22:00');
  const [waketime, setWaketime] = useState('07:00');
  const [status, setStatus] = useState('Record your sleep audio to begin.');

  const playerRef = useRef<AudioPlayer | null>(null);
  // Prevents the 30-second interval from firing playback twice within the same minute.
  const lastPlayedRef = useRef('');

  const startLoop = useCallback(async (uri: string) => {
    try {
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current.remove();
        playerRef.current = null;
      }
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });
      const player = createAudioPlayer({ uri });
      player.loop = true;
      player.play();
      playerRef.current = player;
      setStatus('Playing on loop...');
    } catch {
      setStatus('Playback error — re-record and try again.');
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    (async () => {
      await requestRecordingPermissionsAsync();

      const { granted } = await Notifications.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Notifications disabled',
          'Enable notifications for The Somni in iOS Settings so playback can trigger at your scheduled times.',
        );
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
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

      // If the app was launched by the user tapping a notification, start the loop on open.
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      const launchType = lastResponse?.notification.request.content.data?.type;
      if ((launchType === 'bedtime' || launchType === 'waketime') && savedUri) {
        startLoop(savedUri);
      }

      // Time check that fires while JS is running (foreground + short background windows).
      timer = setInterval(async () => {
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (lastPlayedRef.current === hhmm) return;

        const [uri, bed, wake] = await Promise.all([
          AsyncStorage.getItem(REC_URI_KEY),
          AsyncStorage.getItem(BEDTIME_KEY),
          AsyncStorage.getItem(WAKETIME_KEY),
        ]);

        if (uri && (hhmm === bed || hhmm === wake)) {
          lastPlayedRef.current = hhmm;
          startLoop(uri);
        }
      }, 30_000);
    })();

    const onReceive = Notifications.addNotificationReceivedListener(async (notif) => {
      const t = notif.request.content.data?.type;
      if (t === 'bedtime' || t === 'waketime') {
        const uri = await AsyncStorage.getItem(REC_URI_KEY);
        if (uri) startLoop(uri);
      }
    });

    const onResponse = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      const t = resp.notification.request.content.data?.type;
      if (t === 'bedtime' || t === 'waketime') {
        const uri = await AsyncStorage.getItem(REC_URI_KEY);
        if (uri) startLoop(uri);
      }
    });

    return () => {
      clearInterval(timer);
      onReceive.remove();
      onResponse.remove();
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current.remove();
        playerRef.current = null;
      }
    };
  }, [startLoop]);

  async function toggleRecording() {
    if (isRecording) {
      try {
        await recorder.stop();
        const uri = recorder.uri;
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          shouldPlayInBackground: true,
        });
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
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: true,
        });
        await recorder.prepareToRecordAsync();
        recorder.record();
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

    setStatus(`Scheduled daily — sleep ${bedtime} · wake ${waketime}`);

    Alert.alert(
      'Scheduled',
      `Sleep audio: ${bedtime}\nWake audio: ${waketime}\n\n` +
      'App open → plays automatically at the exact time.\n' +
      'App closed → tap the notification and it plays instantly.',
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

      <Text style={{ marginTop: 32, color: '#666', lineHeight: 22 }}>{status}</Text>
    </View>
  );
}
