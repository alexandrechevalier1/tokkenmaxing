import { StatusBar } from 'expo-status-bar';
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

import { ApiError, currentLimits, fetchReport, normalizeBaseUrl, resetText, sendTargets } from './src/api';
import { Ring } from './src/components/Ring';
import { formatAgo, formatClock, formatPercent } from './src/format';
import { formatExpected, formatRatio } from './src/objective';
import { palette, scaleSvg } from './src/ring';
import { loadCache, loadConnection, saveCache, saveConnection } from './src/storage';
import type { Cached, Connection, LimitKey, LimitUsage, Targets } from './src/types';
import { WIDGET_NAME } from './src/widget/TokenRingWidget';
import { updateWidgets } from './src/widget/widgetTaskHandler';

const POLL_MS = 5000;

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
  const [connection, setConnection] = useState<Connection | null>(null);
  const [cached, setCached] = useState<Cached | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Objectives changed on the phone, shown right away while they are sent to the PC.
  const [pendingTargets, setPendingTargets] = useState<Targets | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const pendingRef = useRef<Targets>({});
  const targetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every objective write: a poll that started before it carries stale objectives.
  const writeSeq = useRef(0);

  // Restore what the app (or the widget) saved last time.
  useEffect(() => {
    void (async () => {
      const [c, k] = await Promise.all([loadConnection(), loadCache()]);
      setConnection(c);
      setCached(k);
      setShowSettings(c == null);
      setLoaded(true);
    })();
  }, []);

  const refresh = useCallback(async (conn: Connection | null) => {
    const seq = writeSeq.current;
    try {
      const next: Cached = { report: await fetchReport(conn), fetchedAt: Date.now() };
      if (seq !== writeSeq.current) return true; // overtaken by an objective change
      setCached(next);
      setError(null);
      await saveCache(next);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('unreachable', String(e)));
      return false;
    }
  }, []);

  // Live polling while the app is in the foreground.
  useEffect(() => {
    if (!loaded || !connection) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refresh(connection);
      timer = setInterval(() => void refresh(connection), POLL_MS);
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
  }, [loaded, connection, refresh]);

  // Keeps countdowns honest.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // Push to the home-screen widget whenever what it shows changes (at most once a minute otherwise).
  const lastWidgetKey = useRef('');
  useEffect(() => {
    if (!loaded || Platform.OS !== 'android') return;
    const r = cached?.report;
    const key = [
      connection != null,
      r?.limits.map((l) => `${l.percent}/${l.target}/${l.resetsAt}`).join(','),
      r?.problem,
      error != null,
      cached && formatClock(cached.fetchedAt),
    ].join('|');
    if (key === lastWidgetKey.current) return;
    lastWidgetKey.current = key;
    void updateWidgets({ configured: connection != null, cached, offline: error != null });
  }, [loaded, connection, cached, error]);

  // Objectives live on the PC: send the change (debounced), show it meanwhile.
  const changeTarget = useCallback(
    (key: LimitKey, value: number) => {
      setTargetError(null);
      pendingRef.current = { ...pendingRef.current, [key]: value };
      setPendingTargets(pendingRef.current);
      if (targetTimer.current) clearTimeout(targetTimer.current);
      targetTimer.current = setTimeout(async () => {
        const sent = pendingRef.current;
        writeSeq.current++;
        try {
          const next: Cached = { report: await sendTargets(connection, sent), fetchedAt: Date.now() };
          writeSeq.current++;
          setCached(next);
          setError(null);
          await saveCache(next);
        } catch (e) {
          setTargetError(e instanceof ApiError ? e.message : String(e));
        }
        // Forget what was sent, unless it changed again in the meantime.
        const rest: Targets = { ...pendingRef.current };
        for (const k of Object.keys(sent) as LimitKey[]) if (rest[k] === sent[k]) delete rest[k];
        pendingRef.current = rest;
        setPendingTargets(Object.keys(rest).length > 0 ? rest : null);
      }, 500);
    },
    [connection],
  );

  useEffect(
    () => () => {
      if (targetTimer.current) clearTimeout(targetTimer.current);
    },
    [],
  );

  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh(connection);
    setRefreshing(false);
  }, [connection, refresh]);

  const onConnect = useCallback(
    async (next: Connection) => {
      const normalized = { baseUrl: normalizeBaseUrl(next.baseUrl), code: next.code.trim().toUpperCase() };
      const ok = await refresh(normalized);
      if (ok) {
        await saveConnection(normalized);
        setConnection(normalized);
        setShowSettings(false);
      }
      return ok;
    },
    [refresh],
  );

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={palette.text} />
      </View>
    );
  }

  const report = cached?.report ?? null;
  const hasData = report?.hasData ?? false;
  const limits = report ? currentLimits(report, now, pendingTargets) : null;
  const contentWidth = Math.min(width, 520) - 32;
  const ringSize = Math.min(Math.floor((contentWidth - 16) / 2), 190);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, width: contentWidth + 32 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onPullToRefresh}
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
          <ConnectionLine connection={connection} error={error} cached={cached} now={now} />
        </View>
        <Pressable onPress={() => setShowSettings((s) => !s)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} hitSlop={8}>
          <Text style={styles.chipText}>{showSettings ? 'Fermer' : 'Réglages'}</Text>
        </Pressable>
      </View>

      {showSettings && <SettingsCard initial={connection} onConnect={onConnect} error={error} />}

      {report?.problem && (
        <View style={[styles.card, styles.warning]}>
          <Text style={styles.warningText}>⚠ Le PC n'arrive plus à lire tes limites : {report.problem}.</Text>
          {report.fetchedAt && <Text style={styles.muted}>Chiffres de {formatClock(report.fetchedAt, now)}.</Text>}
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

      {connection && limits && hasData && (
        <TargetsCard limits={limits} onChange={changeTarget} error={targetError} saving={pendingTargets != null} />
      )}

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

/** Objectives: % of the limit to have used at reset. Stored on the PC, applied everywhere. */
function TargetsCard({
  limits,
  onChange,
  error,
  saving,
}: {
  limits: LimitUsage[];
  onChange: (key: LimitKey, value: number) => void;
  error: string | null;
  saving: boolean;
}) {
  const [barWidth, setBarWidth] = useState(0);
  const names: Record<LimitKey, string> = { session: 'Objectif session', weekly: 'Objectif hebdo' };
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Objectifs</Text>
        {saving && <ActivityIndicator size="small" color={palette.muted} />}
      </View>
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
      {error && <Text style={styles.error}>{error}</Text>}

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

function ConnectionLine({ connection, error, cached, now }: { connection: Connection | null; error: ApiError | null; cached: Cached | null; now: number }) {
  let color: string = palette.onPace;
  let text: string;
  const report = cached?.report;
  if (!connection) {
    color = palette.idle;
    text = 'PC non configuré';
  } else if (error) {
    color = palette.danger;
    text = cached ? `PC hors ligne · données de ${formatClock(cached.fetchedAt, now)}` : 'PC hors ligne';
  } else if (report?.fetchedAt) {
    if (report.problem) color = palette.warning;
    text = `${report.source === 'live' ? 'Claude' : 'Cache Claude Code'} · à jour ${formatAgo(report.fetchedAt, now)}`;
  } else {
    text = 'Connexion…';
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

function SettingsCard({
  initial,
  onConnect,
  error,
}: {
  initial: Connection | null;
  onConnect: (c: Connection) => Promise<boolean>;
  error: ApiError | null;
}) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl.replace(/^http:\/\//, '') ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const disabled = busy || !baseUrl.trim() || !code.trim();

  const submit = async () => {
    if (disabled) return;
    setBusy(true);
    setTried(true);
    await onConnect({ baseUrl, code });
    setBusy(false);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Connexion au PC</Text>
      <Text style={styles.muted}>
        Clique sur un anneau TokkenMaxing dans la barre des tâches Windows : l'adresse et le code sont en bas du panneau. Avec Tailscale sur le PC et le téléphone, l'adresse en 100.x marche partout, même en 4G.
      </Text>
      <Text style={styles.inputLabel}>Adresse du PC</Text>
      <TextInput
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder="100.101.102.103:7420"
        placeholderTextColor={palette.idle}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={styles.input}
      />
      <Text style={styles.inputLabel}>Code</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="ABCD2345"
        placeholderTextColor={palette.idle}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
        style={[styles.input, styles.codeInput]}
        onSubmitEditing={submit}
      />
      {tried && !busy && error && error.kind !== 'not_configured' && <Text style={styles.error}>{error.message}</Text>}
      <Pressable onPress={submit} disabled={disabled} style={({ pressed }) => [styles.button, disabled && styles.buttonDisabled, pressed && styles.pressed]}>
        {busy ? <ActivityIndicator color={palette.text} /> : <Text style={styles.buttonText}>Se connecter</Text>}
      </Pressable>
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  inputLabel: { color: palette.muted, fontSize: 13, marginTop: 4 },
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
  codeInput: { fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }), letterSpacing: 2 },
  error: { color: palette.danger, fontSize: 13, lineHeight: 18 },
  button: { backgroundColor: palette.onPace, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { backgroundColor: palette.surface },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  footer: { color: palette.idle, fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 8 },
});
