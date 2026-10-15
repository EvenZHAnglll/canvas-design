export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Restrict authored colors to literal hex values, safe for both CSS and SVG. */
export function parseHexColor(value: unknown): RgbaColor | undefined {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
    return undefined;
  }
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
    a: value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1,
  };
}

export function toHexColor(color: RgbaColor): string {
  const byte = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}${byte(color.a * 255)}`;
}
