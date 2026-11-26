import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { requestPinWidget } from 'react-native-android-widget';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';

import { ClaudeError, fetchReport, finishLogin, getAccount, pendingLoginState, shortProblem, signOut, startLogin, type Account } from './src/claude';
import { Ring } from './src/components/Ring';
import { formatAgo, formatClock, formatPercent } from './src/format';
import { parseAuthCode } from './src/oauth';
import { formatExpected, formatRatio } from './src/objective';
import { DEFAULT_TARGETS, currentLimits, resetText, targetsFrom, type FullTargets } from './src/report';
import { palette, scaleSvg } from './src/ring';
import { forgetPcConnection, loadCache, loadTargets, saveCache, saveTargets } from './src/storage';
import type { Cached, LimitKey, LimitUsage } from './src/types';
import { WIDGET_NAME } from './src/widget/TokenRingWidget';
import { updateWidgets } from './src/widget/widgetTaskHandler';

/** Claude is asked once a minute while the app is open (the Windows app: every 2 min). */
const POLL_MS = 60_000;
/** Coming back to the app reads again only if the last read is older than this. */
const RESUME_GAP_MS = 20_000;

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Dashboard />
    </SafeAreaProvider>
  );
}

function Dashboard() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [cached, setCached] = useState<Cached | null>(null);
  const [targets, setTargets] = useState<FullTargets>(DEFAULT_TARGETS);
  const [error, setError] = useState<ClaudeError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const cachedRef = useRef<Cached | null>(null);
  const lastAttempt = useRef(0);

  // Restore what the app (or the widget) saved last time.
  useEffect(() => {
    void (async () => {
      const [a, k, t] = await Promise.all([getAccount(), loadCache(), loadTargets()]);
      cachedRef.current = k;
      setAccount(a);
      setCached(k);
      // First start of this version: keep the objectives that were set on the PC.
      const initial = t ?? targetsFrom(k);
      setTargets(initial);
      if (!t) void saveTargets(initial);
      void forgetPcConnection();
      setShowAccount(a == null);
      setLoaded(true);
    })();
  }, []);

  const refresh = useCallback(async () => {
    lastAttempt.current = Date.now();
    try {
      const next = await fetchReport(cachedRef.current);
      cachedRef.current = next;
      setCached(next);
      setError(null);
      await saveCache(next);
    } catch (e) {
      const err = e instanceof ClaudeError ? e : new ClaudeError('bad_response', String(e));
      setError(err);
      if (err.kind === 'signed_out') {
        setAccount(null);
        setShowAccount(true);
      }
    }
  }, []);

  // Live reads while the app is in the foreground and signed in.
  useEffect(() => {
    if (!loaded || !account) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      if (Date.now() - lastAttempt.current > RESUME_GAP_MS) void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [loaded, account, refresh]);

  // Keeps countdowns honest.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // Push to the home-screen widget whenever what it shows changes.
  const lastWidgetKey = useRef('');
  useEffect(() => {
    if (!loaded || Platform.OS !== 'android') return;
    const r = cached?.report;
    const offline = error?.kind === 'offline';
    const problem = error && !offline ? shortProblem(error) : null;
    const key = [
      account != null,
      r?.limits.map((l) => `${l.percent}/${l.resetsAt}`).join(','),
      targets.session,
      targets.weekly,
      offline,
      problem,
      cached && formatClock(cached.fetchedAt),
    ].join('|');
    if (key === lastWidgetKey.current) return;
    lastWidgetKey.current = key;
    void updateWidgets({ configured: account != null, cached, targets, offline, problem });
  }, [loaded, account, cached, targets, error]);

  // Objectives live on the phone.
  const changeTarget = useCallback((key: LimitKey, value: number) => {
    setTargets((t) => {
      const next = { ...t, [key]: value };
      void saveTargets(next);
      return next;
    });
  }, []);

  const onPullToRefresh = useCallback(async () => {
    if (!account) return;
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [account, refresh]);

  const onSignedIn = useCallback((a: Account) => {
    setError(null);
    lastAttempt.current = 0; // read right away
    setAccount(a);
    setShowAccount(false);
  }, []);

  const onSignOut = useCallback(async () => {
    await signOut();
    setAccount(null);
    setError(null);
    setShowAccount(true);
  }, []);

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={palette.text} />
      </View>
    );
  }

  const report = cached?.report ?? null;
  const hasData = report?.hasData ?? false;
  const limits = report ? currentLimits(report, now, targets) : null;
  const contentWidth = Math.min(width, 520) - 32;
  const ringSize = Math.min(Math.floor((contentWidth - 16) / 2), 190);
  const warning = account && error && error.kind !== 'offline' && error.kind !== 'signed_out' ? error : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, width: contentWidth + 32 },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onPullToRefresh}
          enabled={account != null}
          tintColor={palette.text}
          colors={[palette.onPace]}
          progressBackgroundColor={palette.surface}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>TokkenMaxing</Text>
          <ConnectionLine account={account} error={error} cached={cached} now={now} />
        </View>
        <Pressable onPress={() => setShowAccount((s) => !s)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} hitSlop={8}>
          <Text style={styles.chipText}>{showAccount ? 'Fermer' : 'Compte'}</Text>
        </Pressable>
      </View>

      {showAccount && (
        <AccountCard
          account={account}
          expired={!account && error?.kind === 'signed_out' ? error.message : null}
          onSignedIn={onSignedIn}
          onSignOut={onSignOut}
        />
      )}

      {warning && (
        <View style={[styles.card, styles.warning]}>
          <Text style={styles.warningText}>⚠ {warning.message}</Text>
          {cached && <Text style={styles.muted}>Chiffres de {formatClock(cached.fetchedAt, now)}.</Text>}
        </View>
      )}

      {/* Session + Hebdo */}
      <View style={styles.rings}>
        {(limits ?? [null, null]).map((u, i) => {
          const name = i === 0 ? 'Session' : 'Hebdo';
          return (
            <View key={name} style={styles.ringColumn}>
              <Ring size={ringSize} usage={u} hasData={hasData}>
                <Text style={[styles.percent, { fontSize: ringSize * 0.19, color: u && hasData ? u.ink : '#FFFFFF' }]}>
                  {u && hasData ? formatPercent(u.percent) : '…'}
                </Text>
                <Text style={[styles.ringName, { fontSize: ringSize * 0.08, color: u && hasData ? u.ink : '#FFFFFF' }]}>{name}</Text>
              </Ring>
              {u && hasData && <RingDetails u={u} now={now} />}
            </View>
          );
        })}
      </View>

      {limits && hasData && <TargetsCard limits={limits} onChange={changeTarget} />}

      {/* Where the week went */}
      {report && hasData && report.breakdown.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Répartition de la semaine</Text>
          <Text style={styles.muted}>En % de ton quota hebdomadaire</Text>
          {[...report.breakdown]
            .sort((a, b) => b.percentOfLimit - a.percentOfLimit)
            .map((row) => (
              <View key={row.key} style={styles.row}>
                <Text style={[styles.rowLabel, row.percentOfLimit === 0 && styles.dim]}>{row.label}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.min(100, row.percentOfLimit)}%` }]} />
                </View>
                <Text style={[styles.rowValue, row.percentOfLimit === 0 && styles.dim]}>{formatPercent(row.percentOfLimit)}</Text>
              </View>
            ))}
        </View>
      )}

      {Platform.OS === 'android' && <WidgetCard />}

      <Text style={styles.footer}>
        L'anneau suit les % de Claude (Cowork, Claude Code et chats compris). Le point blanc marque où tu devrais en être maintenant pour atteindre ton objectif à la réinitialisation ; la couleur du disque compare ta conso à ce point.
      </Text>
    </ScrollView>
  );
}

/** Under a ring: reset countdown, pace word, ratio to the objective and where the dot is. */
function RingDetails({ u, now }: { u: LimitUsage; now: number }) {
  return (
    <>
      <Text style={styles.reset}>{resetText(u, now)}</Text>
      {u.resetsAt && <Text style={styles.clock}>{formatClock(u.resetsAt, now)}</Text>}
      {u.ratio != null ? (
        <>
          <Text style={[styles.status, { color: lighten(u.color) }]}>{u.statusLabel}</Text>
          <Text style={[styles.ratio, { color: lighten(u.color) }]}>{formatRatio(u)}</Text>
          <Text style={styles.clock}>{formatExpected(u, true)}</Text>
        </>
      ) : (
        u.key !== 'session' && <Text style={[styles.status, styles.dim]}>{u.statusLabel}</Text>
      )}
    </>
  );
}

const STEP = 5;

/** Objectives: % of the limit to have used at reset. Stored on the phone, used by the widget too. */
function TargetsCard({ limits, onChange }: { limits: LimitUsage[]; onChange: (key: LimitKey, value: number) => void }) {
  const [barWidth, setBarWidth] = useState(0);
  const names: Record<LimitKey, string> = { session: 'Objectif session', weekly: 'Objectif hebdo' };
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Objectifs</Text>
      <Text style={styles.muted}>% de la limite à utiliser d'ici la réinitialisation. 100 % : tout utiliser, au rythme du temps qui passe.</Text>
      {limits.map((u) => (
        <View key={u.key} style={styles.stepRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepLabel}>{names[u.key]}</Text>
            <Text style={styles.muted}>{u.expected != null ? formatExpected(u) : u.key === 'session' ? 'Pas de session en cours' : ' '}</Text>
          </View>
          <StepButton label="−" disabled={u.target <= STEP} onPress={() => onChange(u.key, Math.max(STEP, Math.ceil(u.target / STEP) * STEP - STEP))} />
          <Text style={styles.stepValue}>{u.target} %</Text>
          <StepButton label="+" disabled={u.target >= 100} onPress={() => onChange(u.key, Math.min(100, Math.floor(u.target / STEP) * STEP + STEP))} />
        </View>
      ))}

      <View style={styles.legend} onLayout={(e) => setBarWidth(Math.floor(e.nativeEvent.layout.width))}>
        <Text style={styles.muted}>Couleur du disque : ta conso par rapport au point blanc</Text>
        {barWidth > 0 && <SvgXml xml={scaleSvg(barWidth, 10)} width={barWidth} height={10} />}
        <View style={styles.legendLabels}>
          <Text style={styles.legendText}>0 % · trop lent</Text>
          <Text style={styles.legendText}>100 %</Text>
          <Text style={styles.legendText}>200 % · trop vite</Text>
        </View>
      </View>
    </View>
  );
}

function StepButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Augmenter' : 'Diminuer'}
      style={({ pressed }) => [styles.stepButton, disabled && styles.stepButtonDisabled, pressed && styles.pressed]}
    >
      <Text style={[styles.stepButtonText, disabled && styles.dim]}>{label}</Text>
    </Pressable>
  );
}

function ConnectionLine({ account, error, cached, now }: { account: Account | null; error: ClaudeError | null; cached: Cached | null; now: number }) {
  let color: string = palette.onPace;
  let text: string;
  const since = cached ? ` · données de ${formatClock(cached.fetchedAt, now)}` : '';
  if (!account) {
    color = palette.idle;
    text = `Non connecté à Claude${since}`;
  } else if (error?.kind === 'offline') {
    color = palette.danger;
    text = `Hors ligne${since}`;
  } else if (error) {
    color = palette.warning;
    text = `${shortProblem(error)}${since}`;
  } else if (cached) {
    text = `Claude · à jour ${formatAgo(cached.fetchedAt, now)}`;
  } else {
    text = 'Lecture…';
  }
  return (
    <View style={styles.connection}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.muted} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/**
 * Sign-in to Claude, on the phone: Claude's page opens in the browser, you authorize, it shows a
 * code. Copied, the code is picked up from the clipboard on return (or pasted by hand).
 */
function AccountCard({
  account,
  expired,
  onSignedIn,
  onSignOut,
}: {
  account: Account | null;
  expired: string | null;
  onSignedIn: (a: Account) => void;
  onSignOut: () => void;
}) {
  // State of the sign-in in progress: the code Claude shows ends with it.
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const tried = useRef(new Set<string>());

  // A sign-in started before Android closed the app (browser in front) is still valid.
  useEffect(() => {
    if (account) return;
    void pendingLoginState().then((s) => s && setAwaiting(s));
  }, [account]);

  const submit = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (busyRef.current || !text) return;
      busyRef.current = true;
      tried.current.add(text);
      setBusy(true);
      setMessage(null);
      try {
        const a = await finishLogin(text);
        setAwaiting(null);
        setCode('');
        onSignedIn(a);
      } catch (e) {
        setMessage(e instanceof ClaudeError ? e.message : String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onSignedIn],
  );

  // Back from the browser: if the clipboard holds this sign-in's code, use it.
  useEffect(() => {
    if (account || !awaiting) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const check = async () => {
      const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
      if (!text || tried.current.has(text) || parseAuthCode(text)?.state !== awaiting) return;
      setCode(text);
      void submit(text);
    };
    // Android only lets the app read the clipboard once its window has the focus: try a few times.
    const checkSoon = () => [0, 400, 1200].forEach((ms) => timers.push(setTimeout(() => void check(), ms)));
    checkSoon();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && checkSoon());
    return () => {
      sub.remove();
      timers.forEach(clearTimeout);
    };
  }, [account, awaiting, submit]);

  const open = async () => {
    setMessage(null);
    try {
      const { url, state } = await startLogin();
      setAwaiting(state);
      setCode('');
      await WebBrowser.openBrowserAsync(url, { toolbarColor: palette.bg, showTitle: true, enableBarCollapsing: true });
    } catch (e) {
      setMessage(e instanceof ClaudeError ? e.message : "Impossible d'ouvrir le navigateur.");
    }
  };

  const paste = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (!text) {
      setMessage('Le presse-papiers est vide : copie le code sur la page Claude.');
      return;
    }
    setCode(text);
    void submit(text);
  };

  if (account) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Compte Claude</Text>
        <View style={styles.connection}>
          <View style={[styles.dot, { backgroundColor: palette.onPace }]} />
          <Text style={styles.stepLabel}>{account.email ? `Connecté : ${account.email}` : 'Connecté'}</Text>
        </View>
        <Text style={styles.muted}>
          Le téléphone lit tes limites directement chez Claude, sans passer par le PC. Sa connexion est à lui : elle se renouvelle toute seule et ne touche pas à celle de Claude Code.
        </Text>
        <Pressable onPress={onSignOut} style={({ pressed }) => [styles.buttonSecondary, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>Se déconnecter</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Compte Claude</Text>
      {expired && <Text style={styles.error}>{expired}</Text>}
      <Text style={styles.muted}>Connecte ton compte Claude (Pro ou Max) : le téléphone lira tes limites lui-même, sans PC.</Text>

      <Text style={styles.stepLabel}>1. Autoriser</Text>
      <Text style={styles.muted}>La page Claude s'ouvre dans le navigateur. Connecte-toi si besoin, puis autorise l'accès.</Text>
      <Pressable onPress={open} disabled={busy} style={({ pressed }) => [styles.button, busy && styles.buttonDisabled, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>{awaiting ? 'Rouvrir la page Claude' : 'Se connecter à Claude'}</Text>
      </Pressable>

      {awaiting && (
        <>
          <Text style={[styles.stepLabel, { marginTop: 6 }]}>2. Copier le code</Text>
          <Text style={styles.muted}>Claude affiche un code : copie-le avec son bouton, puis reviens ici. Il est repris tout seul.</Text>
          <View style={styles.codeRow}>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Code affiché par Claude"
              placeholderTextColor={palette.idle}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.codeInput, { flex: 1 }]}
              onSubmitEditing={() => void submit(code)}
              returnKeyType="done"
            />
            <Pressable onPress={paste} disabled={busy} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} hitSlop={6}>
              <Text style={styles.chipText}>Coller</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => void submit(code)}
            disabled={busy || !code.trim()}
            style={({ pressed }) => [styles.button, (busy || !code.trim()) && styles.buttonDisabled, pressed && styles.pressed]}
          >
            {busy ? <ActivityIndicator color={palette.text} /> : <Text style={styles.buttonText}>Valider</Text>}
          </Pressable>
        </>
      )}
      {message && <Text style={styles.error}>{message}</Text>}
    </View>
  );
}

function WidgetCard() {
  const [message, setMessage] = useState<string | null>(null);
  const add = async () => {
    const ok = await requestPinWidget({ widgetName: WIDGET_NAME }).catch(() => false);
    setMessage(
      ok
        ? "Confirme l'ajout dans la fenêtre du lanceur."
        : "Ton lanceur ne permet pas l'ajout direct : appui long sur l'écran d'accueil › Widgets › TokkenMaxing.",
    );
  };
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Widget écran d'accueil</Text>
      <Text style={styles.muted}>
        Touche un anneau du widget pour l'actualiser. Android le met aussi à jour seul toutes les 30 min, et en continu tant que l'appli est ouverte.
      </Text>
      <Pressable onPress={add} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>Ajouter le widget</Text>
      </Pressable>
      {message && <Text style={styles.muted}>{message}</Text>}
    </View>
  );
}

/** Same as the Windows dashboard: status text a bit lighter than the disc so it reads on the dark background. */
function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.4);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `rgb(${r}, ${g}, ${b})`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { alignSelf: 'center', paddingHorizontal: 16, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: palette.text, fontSize: 22, fontWeight: '700' },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  chipText: { color: palette.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  rings: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  ringColumn: { flex: 1, alignItems: 'center', gap: 2 },
  percent: { color: '#FFFFFF', fontWeight: '700', fontVariant: ['tabular-nums'] },
  ringName: { color: 'rgba(255,255,255,0.88)', fontWeight: '500' },
  reset: { color: palette.text, fontSize: 14, fontWeight: '600', marginTop: 10 },
  clock: { color: palette.muted, fontSize: 13 },
  status: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 6, paddingHorizontal: 4 },
  ratio: { fontSize: 13, textAlign: 'center', paddingHorizontal: 4, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: '#111A2E', borderRadius: 16, borderWidth: 1, borderColor: palette.surface, padding: 16, gap: 10 },
  warning: { borderColor: palette.danger },
  warningText: { color: palette.danger, fontSize: 14, lineHeight: 20 },
  cardTitle: { color: palette.text, fontSize: 16, fontWeight: '700' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  stepLabel: { color: palette.text, fontSize: 15, fontWeight: '600' },
  stepValue: { color: palette.text, fontSize: 16, fontWeight: '700', width: 58, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: { opacity: 0.4 },
  stepButtonText: { color: palette.text, fontSize: 22, fontWeight: '600', lineHeight: 26 },
  legend: { gap: 6, marginTop: 4 },
  legendLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  legendText: { color: palette.muted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { color: palette.text, fontSize: 14, width: 96 },
  rowValue: { color: palette.text, fontSize: 14, fontWeight: '700', width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] },
  dim: { color: palette.muted },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.surface, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: palette.accent },
  muted: { color: palette.muted, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 16,
  },
  codeInput: { fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }), fontSize: 14 },
  error: { color: palette.danger, fontSize: 13, lineHeight: 18 },
  button: { backgroundColor: palette.onPace, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonSecondary: { backgroundColor: palette.surface, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4, borderWidth: 1, borderColor: palette.border },
  buttonDisabled: { backgroundColor: palette.surface },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  footer: { color: palette.idle, fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 8 },
});
