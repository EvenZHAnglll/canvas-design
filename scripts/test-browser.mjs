import { build } from 'esbuild';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-browser-'));
let browser;
try {
  await build({
    entryPoints: ['tests/html-preview.browser.ts'],
    outfile: path.join(root, 'test.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await writeFile(
    path.join(root, 'index.html'),
    `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'self' 'unsafe-inline'; script-src 'nonce-browser-test';"><link rel="stylesheet" href="test.css"></head><body><div id="app"></div><pre id="result">RUNNING</pre><script nonce="browser-test">window.addEventListener('error', event => document.getElementById('result').textContent = 'FAIL: ' + event.message);</script><script nonce="browser-test" src="test.js"></script></body></html>`,
  );
  let executable = process.env.CHROME_EXECUTABLE;
  if (!executable) {
    const candidates =
      process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        executable = candidate;
        break;
      } catch {
        /* Try the next browser. */
      }
    }
  }
  if (!executable)
    throw new Error('Chrome/Chromium is required. Set CHROME_EXECUTABLE to its executable path.');
  browser = spawn(
    executable,
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-networking',
      '--allow-file-access-from-files',
      '--disable-extensions',
      `--user-data-dir=${path.join(root, 'profile')}`,
      '--window-size=1400,1000',
      '--remote-debugging-pipe',
      '--no-startup-window',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  );
  // Use a private debugging pipe rather than a listening network port. Poll in
  // real time: virtual-time dumping can starve screenshot animation frames.
  const pending = new Map();
  let sequence = 0;
  let buffer = '';
  let stderr = '';
  browser.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  function fail(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  browser.on('error', fail);
  browser.on('exit', (code) => fail(new Error(`Chrome exited (${code}). ${stderr}`)));
  browser.stdio[4].on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  function call(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome timed out: ${method}`));
      }, 20000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
  const { targetId } = await call('Target.createTarget', {
    url: pathToFileURL(path.join(root, 'index.html')).href,
  });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  let report;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await call(
      'Runtime.evaluate',
      { expression: 'document.getElementById("result")?.textContent' },
      sessionId,
    );
    report = result.result.value;
    if (report?.startsWith('PASS:') || report?.startsWith('FAIL:')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!report?.startsWith('PASS:'))
    throw new Error(report ?? 'Browser did not return a test result.');
  console.log(report);
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function rect(selector) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing interaction target');
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
  }
  async function drag(start, end) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start }, sessionId);
    await call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 },
      sessionId,
    );
    for (let step = 1; step <= 5; step++) {
      await call(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseMoved',
          x: start.x + ((end.x - start.x) * step) / 5,
          y: start.y + ((end.y - start.y) * step) / 5,
          buttons: 1,
        },
        sessionId,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 },
      sessionId,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Real input events check that the inert HTML preview still permits all
  // editing gestures on the surrounding React Flow node.
  const nodeSelector = '.react-flow__node.selected';
  const before = await evaluate(
    `['X', 'Y', 'W', 'H'].map(label => Number(document.querySelector('#properties [aria-label="' + label + '"]').value))`,
  );
  const start = await rect(`${nodeSelector} .node-content`);
  await drag(start, { x: start.x + 36, y: start.y + 24 });
  const position = await evaluate(
    `['X', 'Y'].map(label => Number(document.querySelector('#properties [aria-label="' + label + '"]').value))`,
  );
  if (position[0] <= before[0] || position[1] <= before[1])
    throw new Error(
      `HTML card did not drag through its preview: ${JSON.stringify({ before, position })}`,
    );
  const handle = await rect(`${nodeSelector} .react-flow__resize-control.bottom.right`);
  await drag(handle, { x: handle.x + 40, y: handle.y + 20 });
  const size = await evaluate(
    `['W', 'H'].map(label => Number(document.querySelector('#properties [aria-label="' + label + '"]').value))`,
  );
  if (size[0] <= before[2] || size[1] <= before[3]) throw new Error('HTML card did not resize');
  await evaluate(`document.querySelector('[data-tool="connect"]').click()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await drag(
    await rect(`${nodeSelector} .react-flow__handle[data-handleid="right"]`),
    await rect('.react-flow__node[data-id="plain"] .react-flow__handle[data-handleid="bottom"]'),
  );
  if (!(await evaluate(`!!document.querySelector('.react-flow__edge')`)))
    throw new Error('HTML card did not connect');
  await evaluate(`document.querySelector('[data-tool="select"]').click()`);
  console.log('PASS: HTML card drag, resize, and connections using browser pointer input.');
  if (process.env.CANVAS_BROWSER_QA_PATH) {
    const screenshot = await call('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(process.env.CANVAS_BROWSER_QA_PATH, Buffer.from(screenshot.data, 'base64'));
  }
  await call('Browser.close');
} finally {
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    browser.kill('SIGTERM');
    await new Promise((resolve) => browser.once('exit', resolve));
  }
  await rm(root, { recursive: true, force: true });
}
