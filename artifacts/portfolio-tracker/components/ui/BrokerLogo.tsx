import React, { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';

// Known broker name fragments → Clearbit domain
const BROKER_DOMAINS: [string, string][] = [
  ['schwab', 'schwab.com'],
  ['fidelity', 'fidelity.com'],
  ['vanguard', 'vanguard.com'],
  ['robinhood', 'robinhood.com'],
  ['td ameritrade', 'tdameritrade.com'],
  ['etrade', 'etrade.com'],
  ['e*trade', 'etrade.com'],
  ['interactive brokers', 'interactivebrokers.com'],
  ['ibkr', 'interactivebrokers.com'],
  ['webull', 'webull.com'],
  ['tastyworks', 'tastyworks.com'],
  ['tastytrade', 'tastytrade.com'],
  ['sofi', 'sofi.com'],
  ['ally', 'ally.com'],
  ['merrill', 'merrilledge.com'],
  ['chase', 'chase.com'],
  ['jpmorgan', 'jpmorgan.com'],
  ['wells fargo', 'wellsfargo.com'],
  ['bank of america', 'bankofamerica.com'],
  ['citibank', 'citi.com'],
  ['citi', 'citi.com'],
  ['hsbc', 'hsbc.com'],
  ['wealthsimple', 'wealthsimple.com'],
  ['questrade', 'questrade.com'],
  ['qtrade', 'qtrade.ca'],
  ['degiro', 'degiro.com'],
  ['freetrade', 'freetrade.io'],
  ['trading212', 'trading212.com'],
  ['etoro', 'etoro.com'],
  ['saxo', 'home.saxo'],
];

const LOGO_COLORS = ['#5B5FEF', '#00B4D8', '#06D6A0', '#FFB703', '#FB5607', '#8338EC', '#3A86FF', '#FF006E'];

function colorForBroker(broker: string): string {
  let hash = 0;
  for (let i = 0; i < broker.length; i++) hash = broker.charCodeAt(i) + ((hash << 5) - hash);
  return LOGO_COLORS[Math.abs(hash) % LOGO_COLORS.length];
}

function domainForBroker(broker: string): string | null {
  const lower = broker.toLowerCase();
  for (const [fragment, domain] of BROKER_DOMAINS) {
    if (lower.includes(fragment)) return domain;
  }
  return null;
}

interface BrokerLogoProps {
  broker: string;
  size?: number;
}

export function BrokerLogo({ broker, size = 40 }: BrokerLogoProps) {
  const [hasError, setHasError] = useState(false);
  const domain = domainForBroker(broker);
  const color = colorForBroker(broker);
  const fontSize = Math.round(size * 0.38);
  const initials = broker.trim().slice(0, 2).toUpperCase();

  if (!domain || hasError) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 4, backgroundColor: color }]}>
        <Text style={[styles.initial, { fontSize }]}>{initials}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: `https://logo.clearbit.com/${domain}` }}
      style={{ width: size, height: size, borderRadius: size / 4 }}
      onError={() => setHasError(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '700' },
});
