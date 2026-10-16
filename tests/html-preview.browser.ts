import { renderHtmlPreview } from '../src/webview/html-preview';
import {
  applyOperation,
  parseCanvas,
  type AssetPreview,
  type CanvasData,
} from '../src/shared/canvas';
import type { EditRequest } from '../src/shared/edit-session';
import { captureCanvas } from '../src/webview/screenshot';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(predicate: () => boolean, message: string) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}
function send(message: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}

async function run() {
  const host = document.createElement('div');
  host.style.cssText = 'width:320px;height:200px';
  document.body.append(host);
  renderHtmlPreview(
    host,
    `
    <style>.card { display:grid; gap:8px; color:rgb(12, 34, 56); } body { background:red; } :host { display:none !important; }</style>
    <div class="card" onclick="document.body.dataset.executed='yes'" style="padding:12px;background-image:url(https://example.invalid/leak)">
      <b>Hello</b><span>World</span><input type="file" autofocus>
    </div>
    <script>document.body.dataset.executed='yes'</script>
    <iframe srcdoc="<script>parent.document.body.dataset.executed='yes'</script>"></iframe>
    <img src="https://example.invalid/leak" onerror="document.body.dataset.executed='yes'">
    <a href="javascript:alert(1)" target="_top">Link</a>
    <svg onload="alert(1)"><foreignObject><iframe src="https://example.invalid"></iframe></foreignObject></svg>
    <form action="https://example.invalid"><button>Submit</button></form>
    <meta http-equiv="refresh" content="0;url=https://example.invalid"><object data="https://example.invalid"></object>
  `,
    `
    @import 'https://example.invalid/leak';
    @font-face { font-family: leak; src: url(https://example.invalid/leak); }
    .card { --leak:url(https://example.invalid); background:var(--leak); mask-image:u\\72l(https://example.invalid); border-image:image-set('https://example.invalid' 1x); }
    @media (min-width:0px) { .card { border-radius:8px; } }
  `,
  );
  const shadow = host.shadowRoot!;
  assert(shadow.querySelector('.card b')?.textContent === 'Hello', 'HTML structure renders');
  const card = shadow.querySelector<HTMLElement>('.card')!;
  assert(getComputedStyle(card).display === 'grid', 'Inline style blocks render within the node');
  assert(getComputedStyle(card).color === 'rgb(12, 34, 56)', 'Authored colors render');
  assert(getComputedStyle(card).padding === '12px', 'Inline declarations render');
  assert(getComputedStyle(card).borderRadius === '8px', 'Conditional CSS renders');
  assert(
    !shadow.querySelector('script, iframe, img, svg, form, meta, object'),
    'Executable/resource elements are removed',
  );
  assert(
    !card.hasAttribute('onclick') && !shadow.querySelector('a')?.hasAttribute('href'),
    'Event handlers and navigation are removed',
  );
  assert(shadow.querySelector('input')?.type === 'text', 'File inputs are neutralized');
  assert(
    !shadow.querySelector('input')?.hasAttribute('autofocus'),
    'Authored controls cannot take focus',
  );
  assert(
    !shadow.innerHTML.includes('example.invalid'),
    'CSS resource URLs, escaped URLs, image-set, imports and fonts are removed',
  );
  assert(getComputedStyle(host).display === 'block', 'Authored CSS cannot restyle its shadow host');
  assert(
    getComputedStyle(document.body).backgroundColor !== 'rgb(255, 0, 0)',
    'Styles cannot escape into the editor',
  );
  assert(!document.body.dataset.executed, 'Scripts cannot execute');
  renderHtmlPreview(host, '<div>Updated</div>', 'div { color: blue; }');
  assert(
    !shadow.querySelector('.card') && shadow.textContent?.includes('Updated'),
    'Source updates replace stale markup and styles',
  );
  assert(
    shadow.querySelectorAll('div').length === 1,
    'Element selectors style only authored elements, without an extra wrapper',
  );
  host.remove();

  let data: CanvasData = {
    nodes: [
      {
        id: 'plain',
        type: 'text',
        text: 'Plain text remains literal: <b>hello</b>',
        x: 0,
        y: 0,
        width: 320,
        height: 80,
      },
      { id: 'nested', type: 'file', file: 'child.canvas', x: 400, y: 0, width: 320, height: 200 },
    ],
    edges: [],
  };
  let version = 1;
  let editCount = 0;
  const assets: Record<string, AssetPreview> = {
    nested: {
      canvas: {
        nodes: [
          {
            id: 'nested-html',
            type: 'text',
            text: 'Nested fallback',
            x: 0,
            y: 0,
            width: 240,
            height: 140,
            canvasStudio: {
              type: 'html',
              html: '<div class="nested">Nested HTML</div>',
              css: '.nested { width:100%; height:140px; background:#ed3ea4; color:#fff; padding:20px; }',
            },
          },
        ],
        edges: [],
      },
    },
  };
  const states: CanvasData[] = [];
  const redo: CanvasData[] = [];
  function refresh() {
    send({ type: 'state', version, name: 'browser.canvas', data, assets });
  }
  Object.assign(window, {
    acquireVsCodeApi: () => ({
      getState: () => ({ x: 70, y: 70, zoom: 1 }),
      setState: () => {},
      postMessage: (message: { type: string } & Partial<Omit<EditRequest, 'type'>>) => {
        if (message.type === 'ready') queueMicrotask(refresh);
        if (message.type === 'edit') {
          assert(message.baseVersion === version, 'HTML edits use the current version');
          states.push(structuredClone(data));
          redo.length = 0;
          data = applyOperation(data, message.operation!);
          version++;
          editCount++;
          queueMicrotask(() => {
            refresh();
            send({ type: 'ack', requestId: message.requestId, version });
          });
        }
        if (message.type === 'undo' && states.length) {
          redo.push(data);
          data = states.pop()!;
          version++;
          queueMicrotask(refresh);
        }
        if (message.type === 'redo' && redo.length) {
          states.push(data);
          data = redo.pop()!;
          version++;
          queueMicrotask(refresh);
        }
      },
    }),
  });
  await import('../src/webview/main');
  await until(() => !!document.querySelector('.react-flow__node'), 'Editor mounts');
  document.querySelector<HTMLButtonElement>('[data-tool="html"]')!.click();
  await until(() => !!document.querySelector('.draw-layer'), 'HTML creation tool activates');
  const layer = document.querySelector<HTMLElement>('.draw-layer')!;
  // Synthetic pointer events have no active pointer to capture in Chromium.
  layer.setPointerCapture = () => {};
  layer.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: 350, clientY: 350, pointerId: 1, bubbles: true }),
  );
  layer.dispatchEvent(
    new PointerEvent('pointerup', { clientX: 350, clientY: 350, pointerId: 1, bubbles: true }),
  );
  await until(
    () => data.nodes.length === 3 && !!document.querySelector('textarea[aria-label="HTML"]'),
    'HTML tool creates a card and its inspector',
  );
  const id = data.nodes[2].id;
  assert(
    data.nodes[2].type === 'text' && data.nodes[2].canvasStudio?.type === 'html',
    'Creation saves a standard text node',
  );
  assert(
    data.nodes[2].width === 320 && data.nodes[2].height === 200,
    'HTML cards have usable default dimensions',
  );
  assert(
    document.querySelector('.node-text')?.textContent?.includes('<b>hello</b>'),
    'Ordinary text is not interpreted as HTML',
  );
  async function edit(label: string, value: string) {
    const count = editCount;
    const input = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      `#properties [aria-label="${label}"]`,
    )!;
    assert(input, `Inspector has ${label}`);
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => editCount === count + 1, `${label} commits through the edit protocol`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await edit('HTML', '<div class="card">Edited HTML</div>');
  await edit('CSS', '.card { width:100%; height:100%; background:#19c37d; padding:24px; }');
  await edit('Fallback text', 'Portable fallback');
  await edit('W', '360');
  assert(
    data.nodes[2].text === 'Portable fallback' &&
      data.nodes[2].canvasStudio?.html?.includes('Edited HTML'),
    'Fallback and HTML remain independent',
  );
  assert(
    parseCanvas(JSON.stringify(data)).nodes.every((node) =>
      ['text', 'file', 'link', 'group'].includes(node.type),
    ),
    'Saved Canvas uses only standard types',
  );
  await until(
    () =>
      [...document.querySelectorAll<HTMLElement>('.html-preview')].some(
        (preview) => !!preview.shadowRoot?.textContent?.includes('Edited HTML'),
      ),
    'Committed HTML is rendered',
  );
  const nested = document.querySelector<HTMLElement>('.embedded-canvas .html-preview');
  assert(
    nested?.shadowRoot?.textContent?.includes('Nested HTML'),
    'Nested Canvas renders HTML fragments',
  );
  const png = await captureCanvas(document.getElementById('flow')!, data);
  const image = new Image();
  image.src = png;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let green = 0;
  let pink = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] === 25 && pixels[i + 1] === 195 && pixels[i + 2] === 125) green++;
    if (pixels[i] === 237 && pixels[i + 1] === 62 && pixels[i + 2] === 164) pink++;
  }
  assert(green > 1000, `PNG contains the HTML card's actual CSS (${green} pixels)`);
  assert(pink > 1000, `PNG contains nested HTML CSS (${pink} pixels)`);
  const stale = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="HTML"]')!;
  const beforeExternal = editCount;
  data = applyOperation(data, {
    type: 'updateNodes',
    updates: [{ id, patch: { canvasStudio: { html: '<div>Agent update</div>' } } }],
  });
  version++;
  refresh();
  stale.value = '<div>Stale overwrite</div>';
  stale.dispatchEvent(new Event('change'));
  assert(editCount === beforeExternal, 'Stale inspector edits cannot overwrite source updates');
  await until(
    () =>
      [...document.querySelectorAll<HTMLElement>('.html-preview')].some(
        (preview) => !!preview.shadowRoot?.textContent?.includes('Agent update'),
      ),
    'External HTML source updates render',
  );
  await edit('Fallback text', 'Undo me');
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
  );
  await until(() => data.nodes[2].text === 'Portable fallback', 'HTML edits undo');
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
  );
  await until(() => data.nodes[2].text === 'Undo me', 'HTML edits redo');
  data = parseCanvas(
    JSON.stringify({
      ...data,
      nodes: data.nodes.map((node) =>
        node.id === id
          ? { ...node, canvasStudio: { ...node.canvasStudio, html: null, css: 42 } }
          : node,
      ),
    }),
  );
  version++;
  refresh();
  await until(
    () =>
      document.querySelector(`.react-flow__node[data-id="${id}"] .node-text`)?.textContent ===
      'Undo me',
    'Malformed HTML extensions replace the shadow host with readable fallback text',
  );
  data = applyOperation(data, {
    type: 'updateNodes',
    updates: [
      {
        id,
        patch: {
          canvasStudio: {
            html: '<div>Recovered HTML</div>',
            css: 'div { padding:24px; background:#19c37d; height:100%; }',
          },
        },
      },
    ],
  });
  version++;
  refresh();
  await until(
    () =>
      [...document.querySelectorAll<HTMLElement>('.html-preview')].some(
        (preview) => !!preview.shadowRoot?.textContent?.includes('Recovered HTML'),
      ),
    'HTML rendering recovers after invalid extension data',
  );
  document.getElementById('result')!.textContent =
    'PASS: safe static HTML/CSS, style isolation, creation, inspector edits, standard storage, nested previews, source synchronization, undo/redo, and PNG pixels.';
}

void run().catch((error) => {
  document.getElementById('result')!.textContent = `FAIL: ${error.stack ?? error}`;
});
