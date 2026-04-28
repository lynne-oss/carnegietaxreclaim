import React, { useState, useEffect } from 'react';
import * as Font from 'expo-font';
import SignalScreen from './SignalScreen';
import RecordScreen from './RecordScreen';

type Screen = 'signal' | 'record';

export default function App() {
  const [screen, setScreen]       = useState<Screen>('signal');
  const [statement, setStatement] = useState('');

  useEffect(() => {
    Font.loadAsync({
      CormorantGaramond_300Light: { uri: 'https://unpkg.com/@expo-google-fonts/cormorant-garamond@0.4.1/300Light/CormorantGaramond_300Light.ttf' },
      Inter_300Light:             { uri: 'https://unpkg.com/@expo-google-fonts/inter@0.4.2/300Light/Inter_300Light.ttf' },
    }).catch(() => {});
  }, []);

  if (screen === 'signal') {
    return (
      <SignalScreen
        onSkip={() => setScreen('record')}
        onRecord={(stmt) => { setStatement(stmt); setScreen('record'); }}
      />
    );
  }
  return <RecordScreen statement={statement} />;
}
