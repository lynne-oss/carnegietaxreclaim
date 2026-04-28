import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  SafeAreaView, StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Btn from './Btn';
import { C } from './theme';

const SYSTEM_PROMPT =
  `You are the Somni Decision Engine. Your job is to convert a user's input into a short direct statement they will record in their own voice. This statement represents a decision they have already made not a future intention. Use present tense only. Remove all future tense. Remove vague words like more better improve successful aligned abundant. Do not generate motivational affirmational or inspirational language. Do not invent identity claims. Anchor everything in observable behaviour. Keep output under 2 sentences. Output must be something a person can say naturally without overthinking. Output only the final statement. No explanation. If user input includes abundant manifest universe attract energy alignment remove those concepts completely and translate into behaviour. Return ONLY the final statement. No preamble no explanation no formatting.`;

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-haiku-4-5-20251001';

type Phase = 'input' | 'loading' | 'result';
type Msg   = { role: 'user' | 'assistant'; content: string };

interface Props {
  onSkip:   () => void;
  onRecord: (statement: string) => void;
}

export default function SignalScreen({ onSkip, onRecord }: Props) {
  const [phase, setPhase]         = useState<Phase>('input');
  const [input, setInput]         = useState('');
  const [statement, setStatement] = useState('');
  const [history, setHistory]     = useState<Msg[]>([]);

  async function callClaude(msgs: Msg[]) {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
    if (!apiKey) {
      Alert.alert(
        'API key missing',
        'Create a .env file in the project root with:\n\nEXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...\n\nThen restart Expo with --clear.',
      );
      return;
    }
    setPhase('loading');
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
      setHistory(updated);
      setStatement(text);
      setPhase('result');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Check your connection and try again.');
      setPhase('input');
    }
  }

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) { Alert.alert('', 'Enter what you have already decided.'); return; }
    callClaude([{ role: 'user', content: trimmed }]);
  }

  function handleSimplify() {
    callClaude([...history, {
      role: 'user',
      content: 'Simplify further. Shorter. More direct. Higher certainty. Under one sentence.',
    }]);
  }

  function handleTryAgain() {
    setPhase('input');
    setStatement('');
    setHistory([]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B0B0D' }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.title}>The Signal</Text>
          <View style={s.rule} />

          {phase === 'loading' && (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={C.primary} size="small" />
              <Text style={s.loadingText}>Finding your signal...</Text>
            </View>
          )}

          {phase === 'input' && (
            <>
              <Text style={s.label}>What have you already decided?</Text>
              <TextInput
                value={input}
                onChangeText={setInput}
                multiline
                style={s.input}
                placeholderTextColor={C.secondary}
                placeholder="I've decided to…"
              />
              <View style={{ marginTop: 32 }}>
                <Btn label="Find my signal" onPress={handleSubmit} />
              </View>
              <TouchableOpacity onPress={onSkip} style={s.skipWrap} activeOpacity={0.6}>
                <Text style={s.skip}>Already know what to say? Record directly.</Text>
              </TouchableOpacity>
            </>
          )}

          {phase === 'result' && (
            <>
              <Text style={s.resultLabel}>Your recording:</Text>
              <Text style={s.resultStatement}>{'“'}{statement}{'”'}</Text>

              <View style={{ marginTop: 40 }}>
                <Btn label="Record in your voice" onPress={() => onRecord(statement)} />
              </View>
              <View style={{ marginTop: 12 }}>
                <Btn label="Make it simpler" onPress={handleSimplify} />
              </View>
              <View style={{ marginTop: 12 }}>
                <Btn label="Try again" onPress={handleTryAgain} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  inner: {
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 60,
  },
  title: {
    fontFamily: 'CormorantGaramond_300Light',
    fontWeight: '300',
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
    fontWeight: '300',
    fontSize: 11,
    color: C.secondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  input: {
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
    minHeight: 110,
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
    marginTop: 80,
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
    marginBottom: 20,
  },
  resultStatement: {
    fontFamily: 'CormorantGaramond_300Light',
    fontWeight: '300',
    fontSize: 28,
    color: C.primary,
    lineHeight: 40,
    letterSpacing: 0.5,
  },
});
