import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, StyleSheet, TouchableOpacity,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LogEntry, LOG_KEY } from './types';

const CREAM = '#F5F1EB';
const DARK  = '#0B0B0D';
const MID   = '#7A7068';
const RULE  = '#D8D2C8';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatDate(ts: number): string {
  try {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return '';
  }
}

interface Props {
  onBack: () => void;
}

export default function LogScreen({ onBack }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(LOG_KEY)
      .then(raw => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        setEntries(Array.isArray(parsed) ? parsed : []);
      })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={s.inner}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.headerRow}>
          <Text style={s.title}>Intentions</Text>
          <TouchableOpacity onPress={onBack} activeOpacity={0.6} style={s.backWrap}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={s.rule} />

        {entries.length === 0 ? (
          <Text style={s.empty}>No intentions recorded yet.</Text>
        ) : (
          entries.filter(Boolean).map((entry, i) => (
            <View key={entry.id}>
              <View style={s.entry}>
                <Text style={s.entryDate}>{formatDate(entry.timestamp)}</Text>
                {!!entry.text && (
                  <Text style={s.entryText} numberOfLines={2}>{entry.text}</Text>
                )}
              </View>
              {i < entries.length - 1 && <View style={s.entryRule} />}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CREAM,
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
    color: DARK,
    letterSpacing: 2,
  },
  backWrap: {
    paddingBottom: 6,
  },
  back: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 11,
    color: MID,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textDecorationLine: 'underline',
  },
  rule: {
    height: 1,
    backgroundColor: RULE,
    marginBottom: 8,
  },
  empty: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 14,
    color: MID,
    letterSpacing: 0.5,
    marginTop: 48,
    textAlign: 'center',
  },
  entry: {
    paddingVertical: 24,
  },
  entryDate: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 10,
    color: MID,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  entryText: {
    fontFamily: 'CormorantGaramond_300Light',
    fontWeight: '300',
    fontSize: 22,
    color: DARK,
    lineHeight: 32,
    letterSpacing: 0.3,
  },
  entryRule: {
    height: 1,
    backgroundColor: RULE,
  },
});
