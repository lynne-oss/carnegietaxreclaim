import React, { useState, useEffect } from 'react';
import * as Font from 'expo-font';
import RecordScreen from './RecordScreen';
import LogScreen from './LogScreen';

type Tab = 'main' | 'log';

export default function App() {
  const [tab, setTab] = useState<Tab>('main');

  useEffect(() => {
    Font.loadAsync({
      CormorantGaramond_300Light: { uri: 'https://unpkg.com/@expo-google-fonts/cormorant-garamond@0.4.1/300Light/CormorantGaramond_300Light.ttf' },
      Inter_300Light:             { uri: 'https://unpkg.com/@expo-google-fonts/inter@0.4.2/300Light/Inter_300Light.ttf' },
    }).catch(() => {});
  }, []);

  if (tab === 'log') return <LogScreen onBack={() => setTab('main')} />;
  return <RecordScreen onShowLog={() => setTab('log')} />;
}
