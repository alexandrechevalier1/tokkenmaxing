/**
 * Claude sign-in, the pure parts (no native module: tested on the PC with plain Node).
 *
 * OAuth 2 + PKCE, the flow `claude /login` uses when it cannot open a local port ("paste the
 * code"): the browser opens claude.ai, you authorize, and Claude's page shows a code `code#state`
 * to copy back into the app. Constants as in Claude Code 2.1.332.
 */

/** Claude Code's OAuth client (the usage service is made for its tokens). */
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize';
/** Claude's own page that displays the code to copy (no app link or local server needed). */
export const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
export const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
/** The service behind Claude Code's /usage (desktop/PlanUsage.cs reads the same one). */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const OAUTH_BETA = 'oauth-2025-04-20';
/** Enough to read the plan limits; nothing to manage projects, files or MCP servers. */
export const SCOPES = ['user:profile', 'user:inference'];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url without padding (RFC 4648 §5), as PKCE wants it. */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

/** The verifier is base64url text: one byte per character. */
export function asciiBytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

export function authorizeUrl(codeChallenge: string, state: string): string {
  const params: [string, string][] = [
    ['code', 'true'],
    ['client_id', CLIENT_ID],
    ['response_type', 'code'],
    ['redirect_uri', REDIRECT_URI],
    ['scope', SCOPES.join(' ')],
    ['code_challenge', codeChallenge],
    ['code_challenge_method', 'S256'],
    ['state', state],
  ];
  // Built by hand: React Native's URLSearchParams is incomplete.
  return `${AUTHORIZE_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

export interface AuthCode {
  code: string;
  /** null when only the part before "#" was pasted. */
  state: string | null;
}

/**
 * What the user pastes: "code#state" as Claude's page shows it, the code alone, or the whole
 * callback URL (…/oauth/code/callback?code=…&state=…).
 */
export function parseAuthCode(input: string): AuthCode | null {
  const text = input.trim();
  if (!text) return null;

  const fromUrl = /[?&]code=([^&#\s]+)/.exec(text);
  if (fromUrl) {
    const state = /[?&]state=([^&#\s]+)/.exec(text);
    return { code: safeDecode(fromUrl[1]), state: state ? safeDecode(state[1]) : null };
  }

  const m = /^([^#\s]{8,})(?:#([^#\s]+))?$/.exec(text);
  return m ? { code: m[1], state: m[2] ?? null } : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
