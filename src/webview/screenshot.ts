import { toPng } from 'html-to-image';
import { screenshotFrame } from '../shared/screenshot';
import type { CanvasData } from '../shared/canvas';

export async function captureCanvas(container: HTMLElement, data: CanvasData): Promise<string> {
  await document.fonts.ready;
  // Let React commit the latest source/preview and React Flow measure its edges.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const viewport = container.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport) throw new Error('The Canvas renderer is not ready.');
  await Promise.all(
    [...viewport.querySelectorAll<HTMLImageElement>('img')].map(async (image) => {
      try {
        await image.decode();
      } catch {
        throw new Error(`Unable to load image: ${image.alt || 'Canvas image'}`);
      }
    }),
  );
  const frame = screenshotFrame(data);
  // Park the wrapper offscreen, rather than the captured root. Chromium copies
  // logical inset styles too, which can otherwise keep the SVG root offscreen.
  const parking = document.createElement('div');
  Object.assign(parking.style, { position: 'fixed', left: '-100000px', top: '0' });
  const root = document.createElement('div');
  root.className = 'react-flow canvas-export-root';
  Object.assign(root.style, {
    position: 'relative',
    left: '0',
    top: '0',
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    backgroundColor: getComputedStyle(container).getPropertyValue('--canvas').trim() || '#ffffff',
  });
  const clone = viewport.cloneNode(true) as HTMLElement;
  clone.style.transform = `translate(${frame.x}px, ${frame.y}px) scale(${frame.scale})`;
  clone.style.transformOrigin = '0 0';
  for (const control of clone.querySelectorAll(
    '.react-flow__handle, .react-flow__resize-control, .inline-editor',
  ))
    control.remove();
  for (const selected of clone.querySelectorAll('.selected')) selected.classList.remove('selected');
  root.append(clone);
  parking.append(root);
  document.body.append(parking);
  try {
    // html-to-image clones SVG subtrees as a unit. Inline their descendant
    // styles so edge labels and nested Canvas HTML retain their actual layout.
    for (const element of clone.querySelectorAll<SVGElement | HTMLElement>('svg *')) {
      const computed = getComputedStyle(element);
      const styles = [...computed].map(
        (property) => [property, computed.getPropertyValue(property)] as const,
      );
      for (const [property, value] of styles) element.style.setProperty(property, value);
    }
    return await toPng(root, {
      width: frame.width,
      height: frame.height,
      pixelRatio: 1,
      skipFonts: true,
    });
  } finally {
    parking.remove();
  }
}
