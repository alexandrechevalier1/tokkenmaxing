import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { currentLimits, fetchReport } from '../api';
import { loadCache, loadConnection, saveCache } from '../storage';
import type { Cached } from '../types';
import { TokenRingWidget, WIDGET_NAME } from './TokenRingWidget';

export interface WidgetState {
  configured: boolean;
  cached: Cached | null;
  offline: boolean;
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
      limits={report ? currentLimits(report, now) : null}
      hasData={report?.hasData ?? false}
      fetchedAt={state.cached?.fetchedAt ?? null}
      offline={state.offline}
      problem={report?.problem ?? null}
    />
  );
}

/** Reads storage and, if asked, fetches fresh numbers from the PC (runs headless, app closed). */
async function loadState(fetchFresh: boolean): Promise<WidgetState> {
  const [connection, cache] = await Promise.all([loadConnection(), loadCache()]);
  let cached = cache;
  let offline = false;
  if (fetchFresh && connection) {
    try {
      cached = { report: await fetchReport(connection, 8000), fetchedAt: Date.now() };
      await saveCache(cached);
    } catch {
      offline = true;
    }
  }
  return { configured: connection != null, cached, offline };
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
