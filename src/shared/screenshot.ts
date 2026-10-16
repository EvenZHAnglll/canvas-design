import { bounds, type CanvasData } from './canvas';

export const screenshotMaxDimension = 4096;
export const screenshotMaxPixels = 16_000_000;

export function screenshotFrame(data: CanvasData) {
  const box = bounds(data.nodes);
  const padding = 32;
  const width = box.width + padding * 2;
  const height = box.height + padding * 2;
  const scale = Math.min(
    2,
    screenshotMaxDimension / width,
    screenshotMaxDimension / height,
    Math.sqrt(screenshotMaxPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
    x: (padding - box.x) * scale,
    y: (padding - box.y) * scale,
  };
}
