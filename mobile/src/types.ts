/** JSON returned by the Windows app: GET http://<pc>:7420/api/usage (see desktop/PlanUsage.cs). */

export type LimitKey = 'session' | 'weekly';
export type Status = 'under' | 'on_track' | 'over' | 'idle';

/** One ring as the PC sends it. Only these fields are relied on: the rest is recomputed (src/objective.ts). */
export interface WireLimit {
  key: LimitKey;
  /** "Session" (5-hour window) or "Hebdo". */
  label: string;
  /** Usage of the plan limit as shown by Claude, 0..100. */
  percent: number;
  /** When the window resets (the PC projects the weekly one forward when it has passed). */
  resetsAt: string | null;
  /** The objective: % of the limit to have used at reset. */
  target: number;
}

/** One ring as displayed, at a given time (computeLimit). */
export interface LimitUsage extends WireLimit {
  /** Fraction of the window already elapsed. */
  pace: number | null;
  /** Where the usage should be now (target × pace), in %; null without a window. */
  expected: number | null;
  /** percent / expected: 1 = on pace, 2 = twice too fast. */
  ratio: number | null;
  /** percent / 100: how full the ring is. */
  progress: number;
  /** expected / 100: where the white dot sits on the ring. */
  marker: number | null;
  status: Status;
  statusLabel: string;
  /** Disc color, from the scale. */
  color: string;
  /** Text color that reads on the disc. */
  ink: string;
}

export interface BreakdownRow {
  key: string;
  label: string;
  /** Share of the weekly limit used by this product (Cowork, Claude Code, chats…). */
  percentOfLimit: number;
}

export interface UsageReport {
  app: 'TokkenMaxing';
  version: number;
  hasData: boolean;
  /** "live": the PC asked Claude; "cache": Claude Code's stored copy. */
  source: 'live' | 'cache' | 'none';
  fetchedAt: string | null;
  /** Why the PC could not refresh (expired token, no network…), if so. */
  problem: string | null;
  updatedAt: string;
  limits: WireLimit[];
  breakdown: BreakdownRow[];
}

export type Targets = Partial<Record<LimitKey, number>>;

export interface Connection {
  baseUrl: string;
  code: string;
}

export interface Cached {
  report: UsageReport;
  /** Epoch ms of the last successful fetch from the PC. */
  fetchedAt: number;
}
