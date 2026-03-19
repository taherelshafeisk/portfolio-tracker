import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '@/constants/colors';

interface MiniChartProps {
  data: number[];
  width?: number;
  height?: number;
  positive?: boolean;
}

export function MiniChart({ data, width = 80, height = 32, positive = true }: MiniChartProps) {
  if (!data || data.length < 2) return <View style={{ width, height }} />;

  const validData = data.filter(v => v != null && !isNaN(v));
  if (validData.length < 2) return <View style={{ width, height }} />;

  const min = Math.min(...validData);
  const max = Math.max(...validData);
  const range = max - min || 1;
  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const points = validData.map((v, i) => ({
    x: padding + (i / (validData.length - 1)) * chartWidth,
    y: padding + chartHeight - ((v - min) / range) * chartHeight,
  }));

  const pathD = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const cpx = (prev.x + p.x) / 2;
    return `${acc} C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`;
  }, '');

  const fillD = `${pathD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  const lineColor = positive ? colors.positive : colors.negative;
  const gradId = `gradient_${Math.random().toString(36).substr(2, 6)}`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
          <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={fillD} fill={`url(#${gradId})`} />
      <Path d={pathD} stroke={lineColor} strokeWidth={1.5} fill="none" strokeLinecap="round" />
    </Svg>
  );
}
