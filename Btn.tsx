import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { C } from './theme';

export default function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={s.btn}>
      <Text style={s.text}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    backgroundColor: C.btnBg,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 2,
    alignItems: 'center',
  },
  text: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 11,
    letterSpacing: 2.5,
    color: C.btnText,
  },
});
