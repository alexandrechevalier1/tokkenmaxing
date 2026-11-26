/**
 * From Claude's usage answer to the two rings (pure: tested on the PC with plain Node).
 * Same reading as the Windows app (desktop/PlanUsage.cs: PlanSnapshot, UsageReportBuilder).
 */
import { formatClock, formatUntil } from './format';
import { computeLimit } from './objective';
import type { BreakdownRow, Cached, LimitKey, LimitUsage, Targets, UsageReport, WireLimit } from './types';

export const DEFAULT_TARGET = 100;
export type FullTargets = Record<LimitKey, number>;
export const DEFAULT_TARGETS: FullTargets = { session: DEFAULT_TARGET, weekly: DEFAULT_TARGET };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Does this look like the usage service's answer at all? */
export function isUsageAnswer(raw: unknown): raw is Record<string, unknown> {
  return isObject(raw) && ('five_hour' in raw || 'seven_day' in raw);
}

function windowOf(root: Record<string, unknown>, name: string): { percent: number; resetsAt: string | null } | null {
  const w = root[name];
  if (!isObject(w)) return null;
  const percent = num(w.utilization);
  if (percent == null) return null;
  const resets = str(w.resets_at);
  return { percent, resetsAt: resets && Number.isFinite(Date.parse(resets)) ? resets : null };
}

function breakdownOf(root: Record<string, unknown>): BreakdownRow[] {
  const bd = root.seven_day_breakdown;
  if (!isObject(bd) || !Array.isArray(bd.rows)) return [];
  return bd.rows.filter(isObject).map((row) => {
    const label = str(row.display_name) ?? str(row.key) ?? '?';
    return { key: str(row.key) ?? label, label, percentOfLimit: num(row.percent_of_limit) ?? 0 };
  });
}

/**
 * The report the screen and the widget draw, from GET /api/oauth/usage.
 * `previous` keeps two things across reads: the objectives written in it (from the PC, in a report
 * saved by an older version: see targetsFrom), and the weekly reset time. When nothing was used
 * since the weekly reset, Claude gives no new time; the weekly limit
 * resets every 7 days at the same hour, so the last one seen is projected forward
 * (computeLimit → nextWeeklyReset).
 */
export function buildReport(raw: Record<string, unknown>, previous: UsageReport | null, now = new Date()): UsageReport {
  const session = windowOf(raw, 'five_hour');
  const weekly = windowOf(raw, 'seven_day');
  const before = (key: LimitKey) => previous?.limits.find((l) => l.key === key);

  const limit = (key: LimitKey, label: string, w: typeof session, keepReset: boolean): WireLimit => ({
    key,
    label,
    percent: w?.percent ?? 0,
    resetsAt: w?.resetsAt ?? (keepReset ? (before(key)?.resetsAt ?? null) : null),
    target: before(key)?.target ?? DEFAULT_TARGET,
  });

  const iso = now.toISOString();
  return {
    app: 'TokkenMaxing',
    version: 3,
    hasData: session != null || weekly != null,
    source: 'live',
    fetchedAt: iso,
    problem: null,
    updatedAt: iso,
    limits: [limit('session', 'Session', session, false), limit('weekly', 'Hebdo', weekly, true)],
    breakdown: breakdownOf(raw),
  };
}

/** The objectives a report carries: the PC's ones in a report saved by an older version, until the phone has its own. */
export function targetsFrom(cached: Cached | null): FullTargets {
  const out = { ...DEFAULT_TARGETS };
  for (const l of cached?.report.limits ?? []) {
    if ((l.key === 'session' || l.key === 'weekly') && typeof l.target === 'number') out[l.key] = l.target;
  }
  return out;
}

/**
 * The two rings as they are *now*: the white dot moves with time, and a window that rolled over
 * since the last read (phone offline, app closed…) counts from zero again.
 */
export function currentLimits(report: UsageReport, now = Date.now(), targets?: Targets | null): LimitUsage[] {
  return report.limits.slice(0, 2).map((u) => computeLimit(u, report.hasData, now, targets?.[u.key] ?? u.target));
}

/** "Réinit. dans 1 h 12" (+ " · 22:30") / "Pas de session en cours". */
export function resetText(u: LimitUsage, now = Date.now(), withClock = false): string {
  if (!u.resetsAt) return u.key === 'session' ? 'Pas de session en cours' : '';
  const until = `Réinit. ${formatUntil(u.resetsAt, now)}`;
  return withClock ? `${until} · ${formatClock(u.resetsAt, now)}` : until;
}
