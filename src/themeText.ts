import type { TextProps } from '@expo/ui';

/** Expo UI 58's iOS system-font modifier uses fixed point sizes. */
export function accessibleTextStyle(style: TextProps['textStyle'], platform: string, fontScale: number): TextProps['textStyle'] {
  if (!style || platform !== 'ios' || style.fontFamily || !Number.isFinite(fontScale) || fontScale <= 0) return style;
  const fixedFont = style.fontSize !== undefined || style.fontWeight !== undefined || style.lineHeight !== undefined;
  if (!fixedFont && style.letterSpacing === undefined) return style;
  return { ...style,
    ...(fixedFont ? { fontSize: (style.fontSize ?? 17) * fontScale } : {}),
    ...(style.lineHeight === undefined ? {} : { lineHeight: style.lineHeight * fontScale }),
    ...(style.letterSpacing === undefined ? {} : { letterSpacing: style.letterSpacing * fontScale }),
  };
}
