/**
 * The TokkenMaxing ring, as an SVG string. Used by the app (react-native-svg's SvgXml)
 * and by the home-screen widget (SvgWidget), so both look exactly the same.
 *
 * Same contract as the Windows tray icon (desktop/RingRenderer.cs + PlanUsage.cs):
 *  - the ring is the plan usage shown by Claude (session 5 h or week), clockwise from 12 o'clock;
 *  - the white dot is where the usage should be right now to reach the objective at reset;
 *  - the disc color compares the usage to that dot (see src/objective.ts).
 */
import { DARK_INK, IDLE, SCALE } from './objective';

export const palette = {
  idle: IDLE,
  overflow: '#FACC15',
  accent: '#38BDF8',
  onPace: '#1a9850',
  marker: '#FFFFFF',
  halo: DARK_INK,
  track: '#334155',
  arc: '#F8FAFC',
  bg: '#0B1220',
  surface: '#1E293B',
  border: '#334155',
  text: '#F8FAFC',
  muted: '#94A3B8',
  danger: '#F87171',
  warning: '#D97706',
} as const;

export interface RingOptions {
  size: number;
  progress: number;
  color: string;
  /** Where the white dot sits (expected usage / 100), or null for none. */
  marker?: number | null;
  /** Ring width as a fraction of the size. */
  thickness?: number;
  track?: string;
  arc?: string;
}

const f = (n: number) => n.toFixed(2);

function arcPath(cx: number, cy: number, r: number, fraction: number): string {
  const sweep = Math.max(fraction * 360, 1);
  const a = (sweep * Math.PI) / 180;
  const x = cx + r * Math.sin(a);
  const y = cy - r * Math.cos(a);
  const large = sweep > 180 ? 1 : 0;
  return `M ${f(cx)} ${f(cy - r)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(x)} ${f(y)}`;
}

function arc(cx: number, cy: number, r: number, width: number, color: string, fraction: number): string {
  if (fraction >= 0.999) {
    return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${color}" stroke-width="${f(width)}"/>`;
  }
  return `<path d="${arcPath(cx, cy, r, fraction)}" fill="none" stroke="${color}" stroke-width="${f(width)}" stroke-linecap="round"/>`;
}

export function ringSvg({
  size,
  progress,
  color,
  marker = null,
  thickness = 0.085,
  track = palette.track,
  arc: arcColor = palette.arc,
}: RingOptions): string {
  const p = Number.isFinite(progress) && progress > 0 ? progress : 0;
  const cx = size / 2;
  const cy = size / 2;
  const outer = (size / 2) * 0.97;
  const width = size * thickness;
  const r = outer - width / 2;
  const gap = size * 0.05;
  const disc = outer - width - gap;

  const parts = [
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(disc)}" fill="${color}"/>`,
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${track}" stroke-width="${f(width)}"/>`,
  ];
  if (p > 0) parts.push(arc(cx, cy, r, width, arcColor, Math.min(p, 1)));
  if (p > 1) parts.push(arc(cx, cy, r, width, palette.overflow, Math.min(p - 1, 1)));

  if (marker != null && Number.isFinite(marker)) {
    // A white knob on the ring, a little wider than it, outlined in dark so it reads on the
    // white arc as well as on the grey track. Sized to stay inside the bounds.
    const a = ((Math.min(Math.max(marker, 0), 1) * 360 - 90) * Math.PI) / 180;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const halo = Math.max(1, size * 0.012);
    const dot = width / 2 + size * 0.015 - halo;
    parts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(dot + halo)}" fill="${palette.halo}"/>`,
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(dot)}" fill="${palette.marker}"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(size)}" height="${f(size)}" viewBox="0 0 ${f(size)} ${f(size)}">${parts.join('')}</svg>`;
}

/** Legend of the disc colors: the scale from 0 % to 200 % of the objective, as a rounded bar. */
export function scaleSvg(width: number, height: number): string {
  const stops = SCALE.map((c, i) => `<stop offset="${(i / (SCALE.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}" height="${f(height)}" viewBox="0 0 ${f(width)} ${f(height)}">` +
    `<defs><linearGradient id="scale" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>` +
    `<rect x="0" y="0" width="${f(width)}" height="${f(height)}" rx="${f(height / 2)}" fill="url(#scale)"/>` +
    `</svg>`
  );
}
