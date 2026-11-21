import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { palette, ringSvg } from '../ring';
import type { LimitUsage } from '../types';

interface Props {
  size: number;
  usage: LimitUsage | null;
  hasData: boolean;
  thickness?: number;
  children?: ReactNode;
}

/** The same ring as the Windows dashboard and the widget, with optional content in the disc. */
export function Ring({ size, usage, hasData, thickness = 0.09, children }: Props) {
  const ok = hasData && usage != null;
  const progress = ok ? usage.progress : 0;
  const color = ok ? usage.color : palette.idle;
  const marker = ok ? usage.marker : null;

  const xml = useMemo(() => ringSvg({ size, progress, color, marker, thickness }), [size, progress, color, marker, thickness]);

  return (
    <View style={{ width: size, height: size }}>
      <SvgXml xml={xml} width={size} height={size} />
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
