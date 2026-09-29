/** Lucide icon by name, rendered per the style's icon treatment. */
import React from 'react';
import { icons } from 'lucide-react';
import { useVideo } from '../engine/context';
import { alpha } from '../brand/color';

const ALIASES: Record<string, string> = {
  AlertTriangle: 'TriangleAlert',
  CheckCircle: 'CircleCheck',
  CheckCircle2: 'CircleCheckBig',
  BarChart: 'ChartColumn',
  BarChart3: 'ChartColumn',
  LineChart: 'ChartLine',
  PieChart: 'ChartPie',
  TrendingUp: 'TrendingUp',
  Home: 'House',
};

export function iconExists(name: string | undefined): boolean {
  if (!name) return false;
  const n = ALIASES[name] ?? name;
  return Boolean((icons as Record<string, unknown>)[n]);
}

export function Icon({
  name,
  size,
  color,
  treatment,
  stroke,
  bg,
}: {
  name?: string;
  size: number;
  color?: string;
  treatment?: 'line' | 'duotone' | 'filled' | 'badge' | 'plain';
  stroke?: number;
  bg?: string;
}) {
  const { tokens: t } = useVideo();
  const n = name ? ALIASES[name] ?? name : 'Sparkles';
  const Cmp = ((icons as Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>>)[n] ?? icons.Sparkles) as React.ComponentType<{
    size?: number;
    color?: string;
    strokeWidth?: number;
  }>;
  const c = color ?? t.palette.primary;
  const tr = treatment ?? t.icon.style;
  const sw = stroke ?? t.icon.stroke;
  if (tr === 'plain' || tr === 'line') return <Cmp size={size} color={c} strokeWidth={sw} />;
  const box = size * 1.9;
  const background = bg ?? (tr === 'filled' ? c : tr === 'badge' ? alpha(c, 0.16) : alpha(c, 0.14));
  const fg = tr === 'filled' ? t.palette.textOnPrimary : c;
  return (
    <div
      style={{
        width: box,
        height: box,
        borderRadius: tr === 'badge' ? box * 0.3 : box,
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: tr === 'badge' ? `1.5px solid ${alpha(c, 0.4)}` : undefined,
        flexShrink: 0,
      }}
    >
      <Cmp size={size} color={fg} strokeWidth={sw} />
    </div>
  );
}
