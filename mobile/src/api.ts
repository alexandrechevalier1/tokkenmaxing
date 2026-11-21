import { formatClock, formatUntil } from './format';
import { computeLimit } from './objective';
import type { Connection, LimitUsage, Targets, UsageReport } from './types';

export const DEFAULT_PORT = 7420;

export class ApiError extends Error {
  constructor(
    public readonly kind: 'not_configured' | 'unreachable' | 'bad_code' | 'bad_response' | 'outdated_pc',
    message: string,
  ) {
    super(message);
  }
}

/** "192.168.0.4" -> "http://192.168.0.4:7420" ; keeps an explicit scheme or port. */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const hostPart = url.replace(/^https?:\/\//i, '').split('/')[0];
  if (!/:\d+$/.test(hostPart)) url = url.replace(hostPart, `${hostPart}:${DEFAULT_PORT}`);
  return url;
}

async function send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError(
      'unreachable',
      "PC injoignable. Vérifie que TokkenMaxing tourne sur le PC, que Tailscale est actif sur le téléphone (ou que tu es sur le Wi-Fi du PC) et que le pare-feu Windows l'autorise.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function base(connection: Connection | null): string {
  if (!connection?.baseUrl || !connection.code) {
    throw new ApiError('not_configured', "Renseigne l'adresse du PC et le code affichés dans TokkenMaxing sur Windows.");
  }
  return normalizeBaseUrl(connection.baseUrl);
}

const auth = (connection: Connection) => ({ Authorization: `Bearer ${connection.code.trim()}` });

async function readReport(res: Response): Promise<UsageReport> {
  if (res.status === 401) throw new ApiError('bad_code', 'Code refusé par le PC. Recopie le code affiché dans TokkenMaxing.');
  if (!res.ok) throw new ApiError('bad_response', `Le PC a répondu ${res.status}.`);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('bad_response', "Réponse illisible : ce n'est pas TokkenMaxing à cette adresse ?");
  }
  const report = data as Partial<UsageReport>;
  if (report?.app !== 'TokkenMaxing') {
    throw new ApiError('bad_response', "Réponse inattendue : ce n'est pas TokkenMaxing à cette adresse ?");
  }
  if ((report.version ?? 1) < 2 || !Array.isArray(report.limits) || report.limits.length < 2) {
    throw new ApiError('outdated_pc', 'Mets à jour TokkenMaxing sur le PC (version Session / Hebdo).');
  }
  return report as UsageReport;
}

export async function fetchReport(connection: Connection | null, timeoutMs = 6000): Promise<UsageReport> {
  const url = `${base(connection)}/api/usage`;
  return readReport(await send(url, { headers: auth(connection!) }, timeoutMs));
}

/** Changes the objectives on the PC (where they live, shared with the tray and the widget). */
export async function sendTargets(connection: Connection | null, targets: Targets, timeoutMs = 6000): Promise<UsageReport> {
  const query = Object.entries(targets)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${Math.round(v!)}`)
    .join('&');
  const url = `${base(connection)}/api/targets?${query}`;
  const res = await send(url, { method: 'POST', headers: auth(connection!) }, timeoutMs);
  if (res.status === 404 || res.status === 405) {
    throw new ApiError('outdated_pc', 'Mets à jour TokkenMaxing sur le PC pour régler les objectifs depuis le téléphone.');
  }
  return readReport(res);
}

/**
 * The two rings as they are *now*: the white dot moves with time, and a window that rolled over
 * since the PC last asked Claude (phone offline, PC asleep…) counts from zero again.
 * `targets` overrides the objectives while a change is on its way to the PC.
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
