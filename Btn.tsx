import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { C } from './theme';

interface Props {
  label: string;
  onPress: () => void;
  dark?: boolean;
}

export default function Btn({ label, onPress, dark }: Props) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={[s.btn, dark && s.btnDark]}>
      <Text style={[s.text, dark && s.textDark]}>{label.toUpperCase()}</Text>
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
  btnDark: {
    backgroundColor: '#0B0B0D',
  },
  text: {
    fontFamily: 'Inter_300Light',
    fontWeight: '300',
    fontSize: 11,
    letterSpacing: 2.5,
    color: C.btnText,
  },
  textDark: {
    color: '#F5F1EB',
  },
});
