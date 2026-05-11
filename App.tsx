import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import * as Font from 'expo-font';
import RecordScreen from './RecordScreen';
import LogScreen from './LogScreen';

type Tab = 'main' | 'log';

interface BoundaryProps { onBack: () => void; children: React.ReactNode; }
interface BoundaryState { error: Error | null; }

class LogErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[LogScreen crash]', error.message, '\n', error.stack, '\n', info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#F5F1EB', padding: 28, paddingTop: 60 }}>
          <TouchableOpacity onPress={this.props.onBack}>
            <Text style={{ fontSize: 13, color: '#7A7068', marginBottom: 24 }}>← Back</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 13, color: '#cc0000', fontWeight: '600', marginBottom: 8 }}>
            LogScreen error — check console for full details
          </Text>
          <ScrollView>
            <Text style={{ fontSize: 12, color: '#333', fontFamily: 'monospace' }} selectable>
              {error.message}{'\n\n'}{error.stack}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('main');
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    Font.loadAsync({
      CormorantGaramond_300Light: { uri: 'https://unpkg.com/@expo-google-fonts/cormorant-garamond@0.4.1/300Light/CormorantGaramond_300Light.ttf' },
      Inter_300Light:             { uri: 'https://unpkg.com/@expo-google-fonts/inter@0.4.2/300Light/Inter_300Light.ttf' },
    })
      .catch(() => {})
      .finally(() => setFontsReady(true));
  }, []);

  const goBack = () => setTab('main');

  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: '#0B0B0D' }} />;
  if (tab === 'log') return (
    <LogErrorBoundary onBack={goBack}>
      <LogScreen onBack={goBack} />
    </LogErrorBoundary>
  );
  return <RecordScreen onShowLog={() => setTab('log')} />;
}
