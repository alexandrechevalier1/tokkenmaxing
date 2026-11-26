import { FlexWidget, OverlapWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { formatClock, formatPercent, formatUntil } from '../format';
import { palette, ringSvg } from '../ring';
import type { LimitUsage } from '../types';

export const WIDGET_NAME = 'TokenRing';

export interface TokenRingWidgetProps {
  /** Widget size in dp, from WidgetInfo. */
  width: number;
  height: number;
  /** Signed in to Claude. */
  configured: boolean;
  /** [session, weekly], already adjusted for windows that rolled over. */
  limits: LimitUsage[] | null;
  hasData: boolean;
  fetchedAt: number | null;
  offline: boolean;
  problem: string | null;
  /** Epoch ms the widget is rendered at (for countdowns). */
  now: number;
}

/** Session and Hebdo side by side. Tapping a ring refreshes; the rest opens the app. */
export function TokenRingWidget({ width, height, configured, limits, hasData, fetchedAt, offline, problem, now }: TokenRingWidgetProps) {
  const roomy = height >= 140;
  const textBlock = roomy ? 50 : 22;
  const footerBlock = roomy ? 16 : 0;
  const ring = Math.max(40, Math.floor(Math.min((width - 28) / 2, height - textBlock - footerBlock - 16)));

  const footer = !configured
    ? "Ouvre l'appli pour te connecter à Claude"
    : offline
      ? `Hors ligne${fetchedAt ? ` · ${formatClock(fetchedAt, now)}` : ''}`
      : problem
        ? `⚠ ${problem}`
        : fetchedAt
          ? `↻ ${formatClock(fetchedAt, now)}`
          : 'Touchez un anneau pour actualiser';

  const slots: (LimitUsage | null)[] = limits ?? [null, null];
  const names = ['Session', 'Hebdo'];

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={
        hasData && limits
          ? `Session ${formatPercent(limits[0].percent)}, hebdo ${formatPercent(limits[1].percent)}`
          : 'TokkenMaxing'
      }
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: palette.bg,
        borderRadius: 24,
        padding: 8,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', width: 'match_parent' }}>
        {slots.map((u, i) => {
          const ok = hasData && u != null;
          const svg = ringSvg({ size: ring, progress: ok ? u.progress : 0, color: ok ? u.color : palette.idle, marker: ok ? u.marker : null, thickness: 0.1 });
          return (
            <FlexWidget key={names[i]} clickAction="REFRESH" style={{ flexDirection: 'column', alignItems: 'center' }}>
              <OverlapWidget style={{ width: ring, height: ring }}>
                <SvgWidget svg={svg} style={{ width: ring, height: ring }} />
                <FlexWidget style={{ width: ring, height: ring, justifyContent: 'center', alignItems: 'center' }}>
                  <TextWidget
                    text={ok ? formatPercent(u.percent, false) : '…'}
                    style={{ fontSize: Math.max(11, Math.round(ring * 0.22)), color: ok ? (u.ink as `#${string}`) : '#FFFFFF', fontWeight: '700' }}
                  />
                </FlexWidget>
              </OverlapWidget>
              <TextWidget text={names[i]} style={{ fontSize: 12, color: palette.text, fontWeight: '600', marginTop: 3 }} />
              {roomy ? (
                <TextWidget
                  text={ok && u.resetsAt ? formatUntil(u.resetsAt, now) : ok && i === 0 ? 'pas de session' : ' '}
                  maxLines={1}
                  style={{ fontSize: 10, color: palette.muted }}
                />
              ) : null}
            </FlexWidget>
          );
        })}
      </FlexWidget>
      {roomy ? (
        <TextWidget
          text={footer}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 10, color: offline || problem ? palette.danger : palette.muted, marginTop: 4, textAlign: 'center' }}
        />
      ) : null}
    </FlexWidget>
  );
}
