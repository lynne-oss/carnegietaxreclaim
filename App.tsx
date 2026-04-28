import React, { useEffect } from 'react';
import * as Font from 'expo-font';
import RecordScreen from './RecordScreen';

export default function App() {
  useEffect(() => {
    Font.loadAsync({
      CormorantGaramond_300Light: { uri: 'https://unpkg.com/@expo-google-fonts/cormorant-garamond@0.4.1/300Light/CormorantGaramond_300Light.ttf' },
      Inter_300Light:             { uri: 'https://unpkg.com/@expo-google-fonts/inter@0.4.2/300Light/Inter_300Light.ttf' },
    }).catch(() => {});
  }, []);

  return <RecordScreen />;
}
