import React, { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';

const LOGO_COLORS = ['#5B5FEF', '#00B4D8', '#06D6A0', '#FFB703', '#FB5607', '#8338EC', '#3A86FF', '#FF006E'];

function colorForSymbol(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  return LOGO_COLORS[Math.abs(hash) % LOGO_COLORS.length];
}

interface StockLogoProps {
  symbol: string;
  size?: number;
}

export function StockLogo({ symbol, size = 36 }: StockLogoProps) {
  const [hasError, setHasError] = useState(false);
  const color = colorForSymbol(symbol);
  const fontSize = Math.round(size * 0.38);
  const borderRadius = Math.round(size / 4);

  if (hasError) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
        <Text style={[styles.initial, { fontSize }]}>{symbol.charAt(0).toUpperCase()}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: `https://financialmodelingprep.com/image-stock/${symbol.toUpperCase()}.png` }}
      style={{ width: size, height: size, borderRadius }}
      onError={() => setHasError(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '700' },
});
