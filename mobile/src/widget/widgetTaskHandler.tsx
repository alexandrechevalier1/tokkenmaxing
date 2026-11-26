import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { ClaudeError, fetchReport, getAccount, shortProblem } from '../claude';
import { currentLimits, targetsFrom, type FullTargets } from '../report';
import { loadCache, loadTargets, saveCache } from '../storage';
import type { Cached } from '../types';
import { TokenRingWidget, WIDGET_NAME } from './TokenRingWidget';

export interface WidgetState {
  /** Signed in to Claude. */
  configured: boolean;
  cached: Cached | null;
  targets: FullTargets;
  offline: boolean;
  /** Why the last read failed, in a few words (not for "offline"). */
  problem: string | null;
}

function render(info: Pick<WidgetInfo, 'width' | 'height'>, state: WidgetState) {
  const report = state.cached?.report ?? null;
  const now = Date.now();
  return (
    <TokenRingWidget
      now={now}
      width={info.width}
      height={info.height}
      configured={state.configured}
      limits={report ? currentLimits(report, now, state.targets) : null}
      hasData={report?.hasData ?? false}
      fetchedAt={state.cached?.fetchedAt ?? null}
      offline={state.offline}
      problem={state.problem}
    />
  );
}

/** Reads storage and, if asked, fresh numbers from Claude (runs headless, app closed). */
async function loadState(fetchFresh: boolean): Promise<WidgetState> {
  const [account, cache, stored] = await Promise.all([getAccount(), loadCache(), loadTargets()]);
  const state: WidgetState = {
    configured: account != null,
    cached: cache,
    targets: stored ?? targetsFrom(cache),
    offline: false,
    problem: null,
  };
  if (fetchFresh && account) {
    try {
      state.cached = await fetchReport(cache);
      await saveCache(state.cached);
    } catch (e) {
      const err = e instanceof ClaudeError ? e : new ClaudeError('bad_response', String(e));
      if (err.kind === 'signed_out') state.configured = false;
      else if (err.kind === 'offline') state.offline = true;
      else state.problem = shortProblem(err);
    }
  }
  return state;
}

/**
 * Android calls this when the widget is added, every 30 min (updatePeriodMillis), when it is
 * resized and when it is tapped. Tapping a ring sends "REFRESH"; the rest opens the app.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
      props.renderWidget(render(props.widgetInfo, await loadState(true)));
      break;
    case 'WIDGET_RESIZED':
      props.renderWidget(render(props.widgetInfo, await loadState(false)));
      break;
    case 'WIDGET_CLICK':
      if (props.clickAction === 'REFRESH') props.renderWidget(render(props.widgetInfo, await loadState(true)));
      break;
    default:
      break;
  }
}

/** Called by the app while it is open, so the widget follows the live numbers. */
export async function updateWidgets(state: WidgetState): Promise<void> {
  try {
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: (info) => render(info, state),
    });
  } catch {
    // No widget on the home screen, or not on Android: nothing to update.
  }
}
