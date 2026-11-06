// Small shared UI pieces: flags, charts, bars, formatted numbers.

import type { ReactNode } from 'react';
import type { FlagSpec } from '../sim/types';

export function Flag({ flag, w = 36 }: { flag: FlagSpec; w?: number }) {
  const h = (w * 2) / 3;
  const [a, b, c] = flag.colors;
  let body: ReactNode = null;
  switch (flag.pattern) {
    case 'tricolour-v':
      body = (<><rect width={30} height={20} fill={a} /><rect x={10} width={10} height={20} fill={b} /><rect x={20} width={10} height={20} fill={c} /></>);
      break;
    case 'tricolour-h':
      body = (<><rect width={30} height={20} fill={a} /><rect y={6.67} width={30} height={6.67} fill={b} /><rect y={13.33} width={30} height={6.67} fill={c} /></>);
      break;
    case 'cross':
      body = (<><rect width={30} height={20} fill={a} /><rect x={8} width={4} height={20} fill={b} /><rect y={8} width={30} height={4} fill={b} /><rect x={9} width={2} height={20} fill={c} /><rect y={9} width={30} height={2} fill={c} /></>);
      break;
    case 'canton':
      body = (<><rect width={30} height={20} fill={a} /><rect width={13} height={10} fill={b} /><rect y={13} width={30} height={3} fill={c} /></>);
      break;
    case 'diagonal':
      body = (<><rect width={30} height={20} fill={a} /><polygon points="0,20 30,0 30,20" fill={b} /><polygon points="0,18 27,0 30,0 30,2 3,20 0,20" fill={c} /></>);
      break;
    case 'circle':
      body = (<><rect width={30} height={20} fill={a} /><circle cx={15} cy={10} r={6} fill={b} /><circle cx={15} cy={10} r={6} fill="none" stroke={c} strokeWidth={1.2} /></>);
      break;
    case 'chevron':
      body = (<><rect width={30} height={20} fill={a} /><rect y={10} width={30} height={10} fill={c} /><polygon points="0,0 12,10 0,20" fill={b} /></>);
      break;
  }
  const em = flag.emblem;
  const ex = flag.pattern === 'chevron' ? 4.5 : flag.pattern === 'canton' ? 6.5 : 15;
  const ey = flag.pattern === 'canton' ? 5 : 10;
  const emColor = flag.pattern === 'circle' ? a : '#ffffff';
  return (
    <svg className="flag-svg" width={w} height={h} viewBox="0 0 30 20">
      {body}
      {em === 'star' && <polygon transform={`translate(${ex},${ey}) scale(0.9)`} points="0,-4 1.2,-1.2 4,-1.2 1.8,0.6 2.6,3.4 0,1.8 -2.6,3.4 -1.8,0.6 -4,-1.2 -1.2,-1.2" fill={emColor} />}
      {em === 'sun' && <g transform={`translate(${ex},${ey})`}><circle r={2.2} fill={emColor} />{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={-0.35} y={-4.2} width={0.7} height={1.4} fill={emColor} transform={`rotate(${i * 45})`} />)}</g>}
      {em === 'wave' && <path transform={`translate(${ex - 5},${ey})`} d="M0,0 q1.25,-2 2.5,0 t2.5,0 t2.5,0 t2.5,0" stroke={emColor} strokeWidth={1.1} fill="none" />}
      {em === 'mountain' && <polygon transform={`translate(${ex},${ey + 2.5})`} points="-4,0 -1,-5 1,-2.5 2,-3.5 4,0" fill={emColor} />}
      {em === 'fish' && <g transform={`translate(${ex},${ey})`}><ellipse rx={3} ry={1.5} fill={emColor} /><polygon points="2.6,0 4.4,-1.6 4.4,1.6" fill={emColor} /></g>}
    </svg>
  );
}

export function money(v: number, digits = 1): string {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${Math.round(a)}`;
}

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const int = (v: number) => Math.round(v).toLocaleString('en-US');
export const signed = (v: number, f: (x: number) => string) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));

export function Bar({ v, color, max = 1 }: { v: number; color?: string; max?: number }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(1, v / max)) * 100}%`, background: color }} />
    </div>
  );
}

export function LineChart({ series, height = 120, labels, format = (v: number) => String(Math.round(v)) }: { series: { name: string; color: string; data: number[] }[]; height?: number; labels?: string[]; format?: (v: number) => string }) {
  const W = 500, H = height;
  const all = series.flatMap((s) => s.data).filter((v) => Number.isFinite(v));
  if (!all.length) return <div className="muted small">No data yet: history builds month by month.</div>;
  let min = Math.min(0, ...all), max = Math.max(...all);
  if (max - min < 1e-9) max = min + 1;
  const n = Math.max(...series.map((s) => s.data.length));
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * (W - 40) + 36);
  const y = (v: number) => H - 16 - ((v - min) / (max - min)) * (H - 26);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="sparkline">
      <line x1={36} x2={W - 4} y1={y(0)} y2={y(0)} stroke="rgba(160,190,220,0.25)" />
      <text x={2} y={y(max) + 4} fill="#94a7ba" fontSize={10}>{format(max)}</text>
      <text x={2} y={y(min) + 4} fill="#94a7ba" fontSize={10}>{format(min)}</text>
      {labels && labels.length > 1 && (
        <>
          <text x={36} y={H - 2} fill="#6c8094" fontSize={10}>{labels[0]}</text>
          <text x={W - 4} y={H - 2} fill="#6c8094" fontSize={10} textAnchor="end">{labels[labels.length - 1]}</text>
        </>
      )}
      {series.map((s) => (
        <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
      ))}
    </svg>
  );
}

export function Legend({ series }: { series: { name: string; color: string }[] }) {
  return (
    <div className="row small" style={{ flexWrap: 'wrap', gap: 12 }}>
      {series.map((s) => (
        <span key={s.name} className="row" style={{ gap: 4 }}>
          <i style={{ width: 10, height: 3, background: s.color, display: 'inline-block' }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function BarList({ items, format }: { items: { label: string; value: number; color?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="col" style={{ gap: 5 }}>
      {items.map((i) => (
        <div key={i.label}>
          <div className="row small">
            <span>{i.label}</span>
            <span className="spacer" />
            <span className="num">{format(i.value)}</span>
          </div>
          <Bar v={Math.abs(i.value)} max={max} color={i.color ?? (i.value < 0 ? 'var(--bad)' : 'var(--accent2)')} />
        </div>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="col" style={{ gap: 2 }}>
      <span className="row small">
        <span>{label}</span>
        <span className="spacer" />
        <b className="num">{format(value)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o.v} className={`btn sm ${value === o.v ? 'on' : ''}`} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
