import test from 'node:test';
import assert from 'node:assert/strict';
import { enableNumberScrub } from '../src/webview/number-field';

function event(type: string, properties: Record<string, unknown> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), properties);
}

function fixture(value = 100, min = '', max = '') {
  const window = new EventTarget();
  const classes = new Set<string>();
  const input = Object.assign(new EventTarget(), {
    ownerDocument: {
      defaultView: window,
      documentElement: {
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
        },
      },
    },
    classList: new Set<string>(),
    value: String(value),
    min,
    max,
    step: '1',
    disabled: false,
    readOnly: false,
    isConnected: true,
    title: '',
    captured: false,
    focused: false,
    selected: false,
    setPointerCapture() {
      this.captured = true;
    },
    hasPointerCapture() {
      return this.captured;
    },
    releasePointerCapture() {
      this.captured = false;
    },
    focus() {
      this.focused = true;
    },
    select() {
      this.selected = true;
    },
  });
  Object.defineProperty(input, 'valueAsNumber', {
    get: () => (input.value === '' ? NaN : Number(input.value)),
  });
  const previews: number[] = [];
  const commits: number[] = [];
  let cancellations = 0;
  const dispose = enableNumberScrub(input as unknown as HTMLInputElement, {
    preview: (next) => previews.push(next),
    commit: (next) => commits.push(next),
    cancel: () => {
      cancellations++;
    },
  });
  function pointer(type: string, x: number, extra: Record<string, unknown> = {}) {
    const target = type === 'pointerdown' ? input : window;
    const message = event(type, {
      clientX: x,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      ...extra,
    });
    target.dispatchEvent(message);
    return message;
  }
  return {
    input,
    window,
    classes,
    previews,
    commits,
    dispose,
    pointer,
    get cancellations() {
      return cancellations;
    },
  };
}

test('dragging previews both directions and commits only the final value on release', () => {
  const f = fixture();
  assert.equal(f.pointer('pointerdown', 200).defaultPrevented, true);
  f.pointer('pointermove', 220);
  f.pointer('pointermove', 190);
  assert.deepEqual(f.previews, [120, 90]);
  assert.deepEqual(f.commits, []);
  assert.equal(f.input.value, '90');
  assert.equal(f.classes.has('number-scrubbing'), true);
  f.pointer('pointerup', 195);
  assert.deepEqual(f.commits, [95]);
  assert.equal(f.input.captured, false);
  assert.equal(f.classes.has('number-scrubbing'), false);
  f.pointer('pointermove', 250);
  assert.deepEqual(f.previews, [120, 90, 95]);
  const click = event('click');
  f.input.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  f.dispose();
});

test('clicking or tiny movement focuses and selects the value for direct typing without editing', () => {
  const f = fixture();
  f.pointer('pointerdown', 200);
  f.pointer('pointermove', 202);
  f.pointer('pointerup', 202);
  assert.equal(f.input.focused, true);
  assert.equal(f.input.selected, true);
  assert.deepEqual(f.previews, []);
  assert.deepEqual(f.commits, []);
  const click = event('click');
  f.input.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
  f.dispose();
});

test('numeric bounds clamp sizes and styles while coordinates can become negative', () => {
  for (const [initial, min, max, delta, expected] of [
    [30, '20', '', -100, 20],
    [8, '0', '256', -50, 0],
    [16, '1', '256', -100, 1],
    [250, '0', '256', 100, 256],
    [10, '', '', -50, -40],
    [Number.MAX_SAFE_INTEGER - 5, '', '', 100, Number.MAX_SAFE_INTEGER],
  ] as const) {
    const f = fixture(initial, min, max);
    f.pointer('pointerdown', 0);
    f.pointer('pointermove', delta);
    f.pointer('pointermove', delta * 2);
    f.pointer('pointerup', delta);
    assert.deepEqual(f.commits, [expected]);
    f.dispose();
  }
});

test('returning to the original value clears the preview without submitting an edit', () => {
  const f = fixture();
  f.pointer('pointerdown', 200);
  f.pointer('pointermove', 220);
  f.pointer('pointerup', 200);
  assert.deepEqual(f.commits, []);
  assert.equal(f.cancellations, 1);
  assert.equal(f.input.value, '100');
  f.dispose();
});

test('Escape, pointer cancellation, lost capture, blur and disposal restore the original preview', () => {
  for (const reason of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'dispose']) {
    const f = fixture();
    f.pointer('pointerdown', 200);
    f.pointer('pointermove', 220);
    if (reason === 'escape') {
      const escape = event('keydown', { key: 'Escape' });
      f.window.dispatchEvent(escape);
      assert.equal(escape.defaultPrevented, true);
    } else if (reason === 'dispose') f.dispose();
    else if (reason === 'lostpointercapture') f.input.dispatchEvent(event(reason));
    else f.window.dispatchEvent(event(reason, { pointerId: 1 }));
    f.pointer('pointerup', 220);
    assert.deepEqual(f.commits, [], reason);
    assert.equal(f.cancellations, 1, reason);
    assert.equal(f.input.value, '100', reason);
    assert.equal(f.classes.has('number-scrubbing'), false, reason);
    assert.equal(f.input.captured, false, reason);
    f.dispose();
  }
});

test('unrelated pointers cannot change or release the active drag', () => {
  const f = fixture();
  f.pointer('pointerdown', 200);
  f.pointer('pointermove', 220, { pointerId: 2 });
  f.pointer('pointerup', 220, { pointerId: 2 });
  f.pointer('pointercancel', 220, { pointerId: 2 });
  assert.deepEqual(f.previews, []);
  assert.equal(f.input.captured, true);
  f.pointer('pointermove', 210);
  f.pointer('pointerup', 210);
  assert.deepEqual(f.commits, [110]);
  f.dispose();
});

test('touch, secondary buttons, invalid values and noneditable inputs keep native behavior', () => {
  for (const reason of ['touch', 'button', 'invalid', 'disabled', 'readOnly']) {
    const f = fixture();
    if (reason === 'invalid') f.input.value = '';
    if (reason === 'disabled' || reason === 'readOnly') f.input[reason] = true;
    const down = f.pointer(
      'pointerdown',
      200,
      reason === 'touch' ? { pointerType: 'touch' } : reason === 'button' ? { button: 2 } : {},
    );
    assert.equal(down.defaultPrevented, false);
    f.pointer('pointermove', 220);
    f.pointer('pointerup', 220);
    assert.deepEqual(f.previews, []);
    assert.deepEqual(f.commits, []);
    f.dispose();
  }
});
