/**
 * Talks to Claude directly from the phone, with its own sign-in: no PC involved.
 *
 *  - Sign-in (see oauth.ts): the phone gets its own token pair, separate from Claude Code's on the
 *    PC. Refreshing it here never logs Claude Code out.
 *  - The tokens live in expo-secure-store (Android Keystore), never in AsyncStorage, and are
 *    renewed here before they expire.
 *  - The app and the widget's background task share one JS runtime when both are alive: one
 *    refresh at a time (`refreshing`). If another run rotated the refresh token anyway, its result
 *    is picked up from storage instead of signing out.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { formatClock } from './format';
import { CLIENT_ID, OAUTH_BETA, REDIRECT_URI, SCOPES, TOKEN_URL, USAGE_URL, asciiBytes, authorizeUrl, base64url, parseAuthCode } from './oauth';
import { buildReport, isUsageAnswer } from './report';
import type { Cached } from './types';

export type ClaudeErrorKind = 'signed_out' | 'login_failed' | 'offline' | 'rate_limited' | 'refused' | 'bad_response';

export class ClaudeError extends Error {
  constructor(
    public readonly kind: ClaudeErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** A few words for the widget footer. */
export function shortProblem(e: ClaudeError): string {
  switch (e.kind) {
    case 'signed_out':
      return 'Reconnecte-toi à Claude';
    case 'rate_limited':
      return e.message.replace(/\.$/, '');
    case 'refused':
      return 'Claude refuse la lecture';
    case 'offline':
      return 'Hors ligne';
    default:
      return 'Réponse inattendue de Claude';
  }
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scopes: string[];
  email: string | null;
}

interface PendingLogin {
  verifier: string;
  state: string;
  createdAt: number;
}

export interface Account {
  email: string | null;
}

const KEYS = { session: 'tm.claude.session', pending: 'tm.claude.pending' } as const;
const USER_AGENT = 'TokkenMaxing/1.0';
/** A login code is short-lived on Claude's side; past this, start again. */
const PENDING_MAX_AGE_MS = 30 * 60 * 1000;
/** Renew this long before the access token expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

async function readSecure<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeSecure(key: string, value: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    throw new ClaudeError('login_failed', "Le téléphone n'a pas pu enregistrer la connexion dans son stockage sécurisé.");
  }
}

async function remove(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Already gone, or the keystore is unavailable: nothing more to do.
  }
}

export async function getAccount(): Promise<Account | null> {
  const s = await readSecure<Session>(KEYS.session);
  return s ? { email: s.email } : null;
}

export async function signOut(): Promise<void> {
  await Promise.all([remove(KEYS.session), remove(KEYS.pending)]);
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

/** After a 429, no call to Claude before this time. */
let notBefore = 0;

interface Request {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

async function send(url: string, init: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...init.headers },
      signal: controller.signal,
    });
  } catch {
    throw new ClaudeError('offline', 'Pas de connexion à Claude. Vérifie le réseau du téléphone.');
  } finally {
    clearTimeout(timer);
  }
}

const postJson = (url: string, body: Record<string, string>, timeoutMs = 15000) =>
  send(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs);

function rateLimited(res: Response): ClaudeError {
  const seconds = Number(res.headers.get('retry-after'));
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10 * 60 * 1000;
  notBefore = Date.now() + Math.max(wait, 2 * 60 * 1000);
  return new ClaudeError('rate_limited', `Trop de requêtes, nouvel essai à ${formatClock(notBefore)}.`);
}

async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/** The useful part of an OAuth error: {"error":"invalid_grant","error_description":"…"} or {"error":{"message":"…"}}. */
function errorDetail(text: string): string {
  try {
    const data = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    if (typeof data.error_description === 'string') return data.error_description;
    if (typeof data.error === 'string') return data.error;
    const msg = (data.error as { message?: unknown } | undefined)?.message;
    if (typeof msg === 'string') return msg;
  } catch {
    // Not JSON.
  }
  return '';
}

function toSession(data: unknown, previous: Session | null): Session {
  const d = (data ?? {}) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    account?: { email_address?: unknown };
  };
  if (typeof d.access_token !== 'string' || !d.access_token) {
    throw new ClaudeError('bad_response', 'Réponse inattendue de Claude à la connexion.');
  }
  const expiresIn = typeof d.expires_in === 'number' && d.expires_in > 0 ? d.expires_in : 3600;
  return {
    accessToken: d.access_token,
    // Claude may keep the same refresh token: then the response has none.
    refreshToken: typeof d.refresh_token === 'string' && d.refresh_token ? d.refresh_token : (previous?.refreshToken ?? ''),
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: typeof d.scope === 'string' && d.scope.trim() ? d.scope.trim().split(/\s+/) : (previous?.scopes ?? SCOPES),
    email: typeof d.account?.email_address === 'string' ? d.account.email_address : (previous?.email ?? null),
  };
}

// ---------------------------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------------------------

/** Prepares a sign-in and returns the claude.ai page to open, and its state (to recognize the code). */
export async function startLogin(): Promise<{ url: string; state: string }> {
  const verifier = base64url(Crypto.getRandomBytes(32));
  const state = base64url(Crypto.getRandomBytes(32));
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, asciiBytes(verifier));
  // Kept in the secure store: Android may close the app while the browser is in front.
  await writeSecure(KEYS.pending, { verifier, state, createdAt: Date.now() } satisfies PendingLogin);
  return { url: authorizeUrl(base64url(new Uint8Array(digest)), state), state };
}

/** The state of a sign-in started recently (null if none), to spot its code in the clipboard. */
export async function pendingLoginState(): Promise<string | null> {
  const p = await readSecure<PendingLogin>(KEYS.pending);
  return p && Date.now() - p.createdAt < PENDING_MAX_AGE_MS ? p.state : null;
}

/** Exchanges the code copied from Claude's page for the phone's own tokens. */
export async function finishLogin(input: string): Promise<Account> {
  const pending = await readSecure<PendingLogin>(KEYS.pending);
  if (!pending || Date.now() - pending.createdAt >= PENDING_MAX_AGE_MS) {
    throw new ClaudeError('login_failed', 'Touche d\'abord « Se connecter à Claude », puis copie le code affiché par Claude.');
  }
  const parsed = parseAuthCode(input);
  if (!parsed) {
    throw new ClaudeError('login_failed', "Ce n'est pas un code de connexion Claude. Copie-le avec le bouton de la page Claude.");
  }
  if (parsed.state && parsed.state !== pending.state) {
    throw new ClaudeError('login_failed', 'Ce code vient d\'une autre tentative. Touche « Se connecter à Claude » et recommence.');
  }

  const res = await postJson(TOKEN_URL, {
    grant_type: 'authorization_code',
    code: parsed.code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: pending.verifier,
    state: pending.state,
  });
  if (res.status === 429) throw rateLimited(res);
  if (!res.ok) {
    const detail = errorDetail(await bodyText(res));
    throw new ClaudeError(
      'login_failed',
      `Claude a refusé le code (${res.status}${detail ? ` : ${detail}` : ''}). Un code ne sert qu'une fois et expire vite : touche « Se connecter à Claude » et recommence.`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ClaudeError('bad_response', 'Réponse illisible de Claude à la connexion.');
  }
  const session = toSession(data, null);
  await writeSecure(KEYS.session, session);
  await remove(KEYS.pending);
  notBefore = 0;
  return { email: session.email };
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

let refreshing: Promise<Session> | null = null;

const signedOut = (message = 'Connecte ton compte Claude.') => new ClaudeError('signed_out', message);

/**
 * A session whose access token is good for a few more minutes. `rejected`: the token Claude just
 * refused (401), to renew even if it does not look expired.
 */
async function validSession(rejected?: string): Promise<Session> {
  const s = await readSecure<Session>(KEYS.session);
  if (!s) throw signedOut();
  const fresh = s.expiresAt - REFRESH_MARGIN_MS > Date.now();
  if (fresh && (!rejected || s.accessToken !== rejected)) return s;
  refreshing ??= renew(s).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function renew(s: Session): Promise<Session> {
  if (!s.refreshToken) {
    await remove(KEYS.session);
    throw signedOut('Ta connexion Claude a expiré : reconnecte-toi.');
  }
  const res = await postJson(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken,
    client_id: CLIENT_ID,
    scope: s.scopes.join(' '),
  });

  if (res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ClaudeError('bad_response', 'Réponse illisible de Claude au renouvellement de la connexion.');
    }
    const next = toSession(data, s);
    await writeSecure(KEYS.session, next);
    return next;
  }
  if (res.status === 429) throw rateLimited(res);

  const text = await bodyText(res);
  if (res.status === 401 || (res.status === 400 && /invalid_grant|expired|revoked|invalid.{0,10}refresh/i.test(text))) {
    // Another run may have rotated the refresh token meanwhile: its tokens win.
    const stored = await readSecure<Session>(KEYS.session);
    if (stored && stored.refreshToken !== s.refreshToken) return stored;
    await remove(KEYS.session);
    throw signedOut('Ta connexion Claude a expiré ou a été révoquée : reconnecte-toi.');
  }
  const detail = errorDetail(text);
  throw new ClaudeError(
    'bad_response',
    `Claude a répondu ${res.status}${detail ? ` (${detail})` : ''} au renouvellement de la connexion. Si ça dure, déconnecte-toi puis reconnecte-toi.`,
  );
}

// ---------------------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------------------

const getUsage = (token: string, timeoutMs: number) =>
  send(USAGE_URL, { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': OAUTH_BETA } }, timeoutMs);

/** Reads the limits from Claude and builds the rings' report. Throws ClaudeError. */
export async function fetchReport(previous: Cached | null, timeoutMs = 10000): Promise<Cached> {
  if (Date.now() < notBefore) {
    throw new ClaudeError('rate_limited', `Trop de requêtes, nouvel essai à ${formatClock(notBefore)}.`);
  }

  let session = await validSession();
  let res = await getUsage(session.accessToken, timeoutMs);
  if (res.status === 401) {
    session = await validSession(session.accessToken);
    res = await getUsage(session.accessToken, timeoutMs);
  }

  switch (res.status) {
    case 200:
      break;
    case 401:
      await remove(KEYS.session);
      throw signedOut('Claude ne reconnaît plus la connexion du téléphone : reconnecte-toi.');
    case 403:
      throw new ClaudeError('refused', "Claude refuse de donner l'utilisation de ce compte (403). Il faut un abonnement Pro ou Max.");
    case 429:
      throw rateLimited(res);
    default:
      throw new ClaudeError('bad_response', `Claude a répondu ${res.status}.`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new ClaudeError('bad_response', 'Réponse illisible de Claude.');
  }
  if (!isUsageAnswer(raw)) throw new ClaudeError('bad_response', "Réponse inattendue de Claude : le service d'utilisation a peut-être changé.");
  return { report: buildReport(raw, previous?.report ?? null), fetchedAt: Date.now() };
}
