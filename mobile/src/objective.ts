/**
 * Objectives, paced over time. Same rules as the Windows app (desktop/PlanUsage.cs: Palette, UsageReportBuilder).
 *
 *  - The objective is the % of the limit to have used when the window resets (100 % by default).
 *  - Where the usage should be right now: expected = objective × elapsed fraction of the window.
 *    Weekly reset Saturday 08:00, objective 100 %: on Tuesday 08:00, expected = 3/7 ≈ 43 %.
 *    The white dot on the ring marks it.
 *  - The disc color compares the usage to that point (usage / expected) on SCALE: 0 % of the
 *    objective on the left, 100 % (on pace, green) in the middle, 200 % on the right.
 *
 * Recomputed on the phone at render time, so the dot keeps moving between two reads from the PC
 * (the widget can go 30 min without one).
 */
import type { LimitKey, LimitUsage, Status, WireLimit } from './types';

/** From 0 % to 200 % of the objective, evenly spaced: 100 % is the green in the middle. */
export const SCALE = ['#313695', '#4575b4', '#74add1', '#66c2a5', '#1a9850', '#a6d96a', '#fdd835', '#f46d43', '#a50026'] as const;
export const SCALE_MAX = 2;
const ON_PACE_LOW = 0.9;
const ON_PACE_HIGH = 1.1;

export const IDLE = '#64748B';
export const DARK_INK = '#0B1220';

const HOUR = 3600 * 1000;
export const WINDOW_MS: Record<LimitKey, number> = { session: 5 * HOUR, weekly: 7 * 24 * HOUR };

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function colorForRatio(ratio: number): string {
  const r = Number.isFinite(ratio) ? ratio : 0;
  const t = (Math.min(Math.max(r / SCALE_MAX, 0), 1)) * (SCALE.length - 1);
  const i = Math.min(Math.floor(t), SCALE.length - 2);
  const f = t - i;
  const a = rgb(SCALE[i]);
  const b = rgb(SCALE[i + 1]);
  return `#${a.map((x, k) => hex2(x + (b[k] - x) * f)).join('')}`;
}

/** White text on dark discs, near-black on light ones (the scale has both). */
export function inkFor(hex: string): string {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex).map(lin);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= 3 ? '#FFFFFF' : DARK_INK;
}

export function statusFor(ratio: number | null): Status {
  if (ratio == null) return 'idle';
  return ratio < ON_PACE_LOW ? 'under' : ratio <= ON_PACE_HIGH ? 'on_track' : 'over';
}

const WORDS: Record<Status, string> = {
  under: 'Sous le rythme',
  on_track: 'Dans le rythme',
  over: 'Au-dessus du rythme',
  idle: '',
};

/** The weekly limit resets every 7 days at the same time: the next reset after `now`. */
export function nextWeeklyReset(knownMs: number, now: number): number {
  if (knownMs > now) return knownMs;
  const week = WINDOW_MS.weekly;
  return knownMs + (Math.floor((now - knownMs) / week) + 1) * week;
}

/** One ring as it is *now*, from what the PC sent (any report version) and the objective to apply. */
export function computeLimit(u: WireLimit, hasData: boolean, now: number, target = u.target): LimitUsage {
  let percent = u.percent;
  let resets = u.resetsAt ? Date.parse(u.resetsAt) : NaN;
  if (Number.isFinite(resets) && resets <= now) {
    // The window rolled over since the PC asked Claude: Claude counts from zero again.
    percent = 0;
    resets = u.key === 'weekly' ? nextWeeklyReset(resets, now) : NaN;
  }

  const hasWindow = Number.isFinite(resets);
  const pace = hasWindow ? Math.min(Math.max(1 - (resets - now) / WINDOW_MS[u.key], 0), 1) : null;
  const expected = hasData && pace != null ? target * pace : null;
  const ratio = expected == null ? null : expected > 0 ? percent / expected : percent > 0 ? SCALE_MAX : 1;
  const status = statusFor(ratio);
  const color = ratio == null ? IDLE : colorForRatio(ratio);

  return {
    key: u.key,
    label: u.label,
    percent,
    resetsAt: hasWindow ? new Date(resets).toISOString() : null,
    pace,
    target,
    expected,
    ratio,
    progress: percent / 100,
    marker: expected == null ? null : expected / 100,
    status,
    statusLabel: !hasData
      ? 'En attente de données'
      : ratio == null
        ? u.key === 'session'
          ? 'Pas de session en cours'
          : 'Réinitialisation inconnue'
        : WORDS[status],
    color,
    ink: inkFor(color),
  };
}

/** "102 % de l'objectif", or "" without a window. */
export function formatRatio(u: LimitUsage): string {
  return u.ratio == null ? '' : `${Math.round(Math.min(u.ratio, 9.99) * 100)} % de l'objectif`;
}

/** "Attendu maintenant : 43 %", or "" without a window. */
export function formatExpected(u: LimitUsage, short = false): string {
  if (u.expected == null) return '';
  return short ? `attendu ${Math.round(u.expected)} %` : `Attendu maintenant : ${Math.round(u.expected)} %`;
}
