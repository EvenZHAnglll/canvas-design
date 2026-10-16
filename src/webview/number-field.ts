interface NumberScrubOptions {
  preview(value: number): void;
  commit(value: number): void;
  cancel(): void;
}

/** Preview a mouse drag locally, then send just one edit when the pointer is released. */
export function enableNumberScrub(
  input: HTMLInputElement,
  options: NumberScrubOptions,
): () => void {
  const document = input.ownerDocument;
  const window = document.defaultView!;
  let cancelGesture: (() => void) | undefined;
  let suppressClick = false;

  function pointerDown(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || input.disabled || input.readOnly)
      return;
    const initial = input.valueAsNumber;
    if (!Number.isFinite(initial)) return;
    cancelGesture?.();
    suppressClick = false;
    event.preventDefault();
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const min = input.min === '' ? -Number.MAX_SAFE_INTEGER : Number(input.min);
    const max = input.max === '' ? Number.MAX_SAFE_INTEGER : Number(input.max);
    const step = Number(input.step) || 1;
    const events = new AbortController();
    let dragging = false;
    let current = initial;
    let finished = false;

    function move(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      const delta = event.clientX - startX;
      if (!dragging && Math.abs(delta) < 3) return;
      dragging = true;
      document.documentElement.classList.add('number-scrubbing');
      event.preventDefault();
      const next = Math.max(min, Math.min(max, initial + Math.round(delta) * step));
      if (next === current) return;
      current = next;
      input.value = String(current);
      options.preview(current);
    }
    function finish(commit: boolean) {
      if (finished) return;
      finished = true;
      events.abort();
      cancelGesture = undefined;
      document.documentElement.classList.remove('number-scrubbing');
      if (input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId);
      suppressClick = dragging;
      if (dragging) {
        if (commit && current !== initial) options.commit(current);
        else {
          input.value = String(initial);
          options.cancel();
        }
      } else if (commit) {
        input.focus({ preventScroll: true });
        if (input.isConnected) input.select();
      }
    }
    cancelGesture = () => finish(false);
    input.setPointerCapture(pointerId);
    window.addEventListener('pointermove', move, { signal: events.signal });
    window.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerId !== pointerId) return;
        if (dragging) move(event);
        finish(true);
      },
      { signal: events.signal },
    );
    window.addEventListener(
      'pointercancel',
      (event) => {
        if (event.pointerId === pointerId) finish(false);
      },
      { signal: events.signal },
    );
    input.addEventListener('lostpointercapture', () => finish(false), { signal: events.signal });
    window.addEventListener('blur', () => finish(false), { signal: events.signal });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      },
      { capture: true, signal: events.signal },
    );
  }
  function click(event: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }
  input.classList.add('scrubbable-number');
  input.title = 'Drag left or right to adjust · Click to type · Esc to cancel';
  input.addEventListener('pointerdown', pointerDown);
  input.addEventListener('click', click);
  return () => {
    cancelGesture?.();
    input.removeEventListener('pointerdown', pointerDown);
    input.removeEventListener('click', click);
  };
}
