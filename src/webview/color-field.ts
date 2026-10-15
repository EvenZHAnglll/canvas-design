import { parseHexColor, toHexColor } from '../shared/colors';

const presets = [
  ['White', '#ffffff'],
  ['Porcelain', '#f4f3ef'],
  ['Mist', '#e3e6e8'],
  ['Stone', '#b9b6af'],
  ['Graphite', '#525962'],
  ['Sand', '#d8c9b5'],
  ['Clay', '#c3a393'],
  ['Rose', '#c5a3ad'],
  ['Mauve', '#b5a6bd'],
  ['Sage', '#acbba7'],
  ['Eucalyptus', '#8faea5'],
  ['Cloud blue', '#a4b9cc'],
  ['Slate blue', '#8797b1'],
] as const;

interface ColorSource {
  button: HTMLButtonElement;
  update(value: string): void;
}
interface ColorPicker {
  owner: string;
  label: string;
  sync(value: string, change: (value: string) => void, source: ColorSource): void;
  close(restoreFocus?: boolean): void;
}
let activePicker: ColorPicker | undefined;

/** Keep a picker through document acknowledgements, but close it when inspection changes. */
export function syncColorPickerOwner(owner: string | undefined) {
  if (activePicker && activePicker.owner !== owner) activePicker.close();
}

export function colorField(
  owner: string,
  label: string,
  value: string,
  change: (value: string) => void,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'field color-field';
  const title = document.createElement('span');
  title.className = 'field-label';
  title.textContent = label;
  const hex = document.createElement('span');
  hex.className = 'color-value';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'color-trigger transparency-grid';
  button.setAttribute('aria-label', `Change ${label.toLowerCase()} color`);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const preview = document.createElement('span');
  button.append(preview);
  const source: ColorSource = {
    button,
    update(value) {
      preview.style.backgroundColor = value;
      hex.textContent = value.toUpperCase();
      button.title = `Change ${label.toLowerCase()} color · ${value.toUpperCase()}`;
    },
  };
  source.update(value);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (activePicker?.owner === owner && activePicker.label === label) {
      activePicker.close(true);
    } else {
      activePicker?.close();
      openColorPicker(owner, label, value, change, source);
    }
  });
  root.append(title, hex, button);
  if (activePicker?.owner === owner && activePicker.label === label) {
    activePicker.sync(value, change, source);
  }
  return root;
}

function openColorPicker(
  owner: string,
  label: string,
  value: string,
  change: (value: string) => void,
  source: ColorSource,
) {
  let color = parseHexColor(value)!;
  let disposed = false;
  const events = new AbortController();
  const panel = document.createElement('div');
  panel.id = 'color-picker';
  panel.className = 'color-picker';
  panel.popover = 'auto';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `${label} color picker`);
  const heading = document.createElement('div');
  heading.className = 'color-heading';
  const title = document.createElement('span');
  title.textContent = `${label} color`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'color-picker-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close color picker');
  close.addEventListener('click', () => picker.close(true));
  heading.append(title, close);

  const palette = document.createElement('div');
  palette.className = 'color-presets';
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', `${label} presets`);
  const swatches: { button: HTMLButtonElement; hex?: string }[] = [];
  const addSwatch = (name: string, hex?: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `color-swatch${hex ? '' : ' transparency-grid'}`;
    button.title = hex ? `${name} · ${hex.toUpperCase()}` : name;
    button.setAttribute('aria-label', `${label}: ${name}`);
    if (hex) button.style.backgroundColor = hex;
    else button.textContent = '∅';
    button.addEventListener('click', () => {
      color = hex ? parseHexColor(hex)! : { ...color, a: 0 };
      update();
      change(toHexColor(color));
    });
    swatches.push({ button, hex });
    palette.append(button);
  };
  for (const [name, hex] of presets) addSwatch(name, hex);
  addSwatch('Transparent');

  const channels = document.createElement('div');
  channels.className = 'color-channels';
  const inputs = new Map<keyof typeof color, HTMLInputElement>();
  for (const channel of ['r', 'g', 'b', 'a'] as const) {
    const field = document.createElement('label');
    field.className = 'color-channel';
    const caption = document.createElement('span');
    caption.textContent = channel.toUpperCase();
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = channel === 'a' ? '1' : '255';
    input.step = channel === 'a' ? '0.01' : '1';
    input.setAttribute('aria-label', `${label} ${channel.toUpperCase()}`);
    input.title = channel === 'a' ? 'Alpha: 0 = transparent, 1 = opaque' : '0–255';
    input.addEventListener('change', () => {
      const number = input.valueAsNumber;
      if (!Number.isFinite(number)) {
        update();
        return;
      }
      const clamped = Math.max(0, Math.min(Number(input.max), number));
      color = { ...color, [channel]: channel === 'a' ? clamped : Math.round(clamped) };
      update();
      change(toHexColor(color));
    });
    inputs.set(channel, input);
    field.append(input, caption);
    channels.append(field);
  }
  function update() {
    source.update(toHexColor(color));
    for (const [channel, input] of inputs) {
      input.value = String(channel === 'a' ? Math.round(color.a * 100) / 100 : color[channel]);
    }
    for (const swatch of swatches) {
      const selected = swatch.hex
        ? color.a === 1 && swatch.hex === toHexColor(color).slice(0, 7)
        : color.a === 0;
      swatch.button.setAttribute('aria-pressed', String(selected));
    }
  }
  function position() {
    if (disposed || !source.button.isConnected) return;
    const anchor = source.button.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    // The top layer escapes the inspector's scrolling container.
    panel.style.left = `${Math.max(12, Math.min(anchor.left - rect.width - 12, window.innerWidth - rect.width - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(anchor.top, window.innerHeight - rect.height - 12))}px`;
  }
  function bindSource() {
    source.button.popoverTargetElement = panel;
    source.button.setAttribute('aria-expanded', 'true');
    source.button.setAttribute('aria-controls', panel.id);
    source.update(toHexColor(color));
  }
  const picker: ColorPicker = {
    owner,
    label,
    sync(value, onChange, nextSource) {
      source = nextSource;
      change = onChange;
      bindSource();
      const nextColor = parseHexColor(value)!;
      // An ack must not erase unfinished typing in another channel.
      if (toHexColor(nextColor) !== toHexColor(color)) {
        color = nextColor;
        update();
      }
      queueMicrotask(position);
    },
    close(restoreFocus = false) {
      if (disposed) return;
      disposed = true;
      events.abort();
      source.button.setAttribute('aria-expanded', 'false');
      source.button.removeAttribute('aria-controls');
      source.button.popoverTargetElement = null;
      panel.remove();
      if (activePicker === picker) activePicker = undefined;
      if (restoreFocus && source.button.isConnected) source.button.focus();
    },
  };
  panel.addEventListener(
    'toggle',
    () => {
      if (!panel.matches(':popover-open')) picker.close();
    },
    { signal: events.signal },
  );
  panel.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      picker.close(true);
    }
  });
  window.addEventListener('resize', position, { signal: events.signal });
  document.addEventListener('scroll', position, { capture: true, signal: events.signal });
  panel.append(heading, palette, channels);
  document.body.append(panel);
  activePicker = picker;
  bindSource();
  update();
  panel.showPopover();
  position();
  (
    swatches.find((swatch) => swatch.button.getAttribute('aria-pressed') === 'true')?.button ??
    inputs.get('r')!
  ).focus();
}
