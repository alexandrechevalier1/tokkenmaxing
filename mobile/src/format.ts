/** Same formatting rules as the Windows app (desktop/PlanUsage.cs, class Fmt). */

const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const toMs = (t: string | number) => (typeof t === 'number' ? t : Date.parse(t));

export function formatPercent(percent: number, space = true): string {
  return `${Math.floor(percent)}${space ? ' ' : ''}%`;
}

/** "dans 1 h 12", "dans 3 j 4 h". */
export function formatUntil(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const s = (toMs(iso) - now) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s <= 0) return 'maintenant';
  if (s < 3600) return `dans ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `dans ${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `dans ${Math.floor(s / 86400)} j ${Math.floor((s % 86400) / 3600)} h`;
}

/** "22:30" today, "sam. 08:00" otherwise. */
export function formatClock(t: string | number | null, now = Date.now()): string {
  if (t == null) return '';
  const d = new Date(toMs(t));
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date(now).toDateString() ? hm : `${DAYS[d.getDay()]} ${hm}`;
}

export function formatAgo(t: string | number | null | undefined, now = Date.now()): string {
  if (t == null) return 'jamais';
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}
