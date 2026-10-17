import './style.css';
import { applyOperation, getStyle, isFramelessFileNode, type AssetPreview, type CanvasData, type CanvasNode, type CanvasState, type Operation } from '../shared/canvas';
import { EditSession } from '../shared/edit-session';
import { createCanvasRenderer } from './flow';
import { colorField, syncColorPickerOwner } from './color-field';
import { enableNumberScrub } from './number-field';
import { captureCanvas } from './screenshot';
import { enableFileDrop } from './file-drop';
import { defaultCss, defaultHtml, isHtmlNode } from '../shared/html';
import { descendantIds, getHierarchy, nodeName, type MoveNode } from '../shared/hierarchy';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
const vscode = acquireVsCodeApi();
type Tool = 'select' | 'hand' | 'rectangle' | 'ellipse' | 'text' | 'html' | 'group' | 'connect';
const session = new EditSession();
let data: CanvasData = { nodes: [], edges: [] };
let renderer: ReturnType<typeof createCanvasRenderer>;
let version = -1;
let documentUri = '';
let assets: Record<string, AssetPreview> = {};
let tool: Tool = 'select';
let selection = new Set<string>();
let selectedEdge: string | undefined;
let loaded = false;
let invalid = false;
let draggedNode: { id: string; version: number } | undefined;
let inspectorPreview: Operation | undefined;
let numberFieldDisposers: (() => void)[] = [];
let toastTimer: ReturnType<typeof setTimeout>;
const saved = vscode.getState() as { x?: number; y?: number; zoom?: number; collapsed?: string[]; expandedReferences?: string[]; outlinerHidden?: boolean; detailsHidden?: boolean } | undefined;
const collapsed = new Set(saved?.collapsed ?? []);
const expandedReferences = new Set(saved?.expandedReferences ?? []);
const sidebarHidden = { outliner: saved?.outlinerHidden === true, details: saved?.detailsHidden === true };
function sidebarIcon(side: 'outliner' | 'details'): string {
  const divider = side === 'outliner' ? 9 : 15;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M${divider} 4v16"/></svg>`;
}
let camera = { x: saved?.x ?? 70, y: saved?.y ?? 70, zoom: saved?.zoom ?? 1 };
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="workspace">
  <aside id="outliner-sidebar" class="outliner-sidebar" aria-label="Outliner sidebar">
    <section id="outliner-panel"><div class="panel-heading"><span>Outliner</span><span id="node-count">0 objects</span><button id="hide-outliner" class="sidebar-button panel-collapse" title="Hide Outliner" aria-label="Hide Outliner" aria-controls="outliner-sidebar" aria-expanded="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 7-5 5 5 5"/></svg></button></div><div id="scene-root" tabindex="0" title="Drop here to move to the scene root">Scene</div><div id="outliner" role="tree" aria-label="Scene nodes"></div><div class="outliner-hint">Top = front · Drop on a group to nest</div></section>
  </aside>
  <main id="stage" tabindex="0" aria-label="Design canvas">
    <button id="show-outliner" class="sidebar-button panel-restore outliner-restore" title="Show Outliner" aria-label="Show Outliner" aria-controls="outliner-sidebar" aria-expanded="false" hidden>${sidebarIcon('outliner')}</button>
    <button id="show-details" class="sidebar-button panel-restore details-restore" title="Show Details" aria-label="Show Details" aria-controls="details-sidebar" aria-expanded="false" hidden>${sidebarIcon('details')}</button>
    <div class="toolbar" role="toolbar" aria-label="Canvas tools">
      <button data-tool="select" title="Select (V)" aria-label="Select">↖</button><button data-tool="hand" title="Pan (H or hold Space)" aria-label="Pan">✋</button><i></i>
      <button data-tool="rectangle" title="Rounded rectangle (R)" aria-label="Rounded rectangle">▢</button><button data-tool="ellipse" title="Ellipse (O)" aria-label="Ellipse">○</button><button data-tool="text" title="Text (T)" aria-label="Text">T</button><button data-tool="group" title="Group (G)" aria-label="Group">▤</button><button data-tool="connect" title="Connect two nodes (C)" aria-label="Connect">↗</button><i></i>
      <button data-tool="html" title="HTML fragment (U)" aria-label="HTML fragment">&lt;&gt;</button><i></i><button id="image" title="Insert project image" aria-label="Insert image">▧</button><button id="canvas" title="Embed another Canvas" aria-label="Embed Canvas">⊞</button><button id="file" title="Insert file reference" aria-label="Insert file">📎</button>
    </div>
    <div id="flow"></div>
    <div id="empty"><span class="empty-icon">▧</span><h1>A shared space for ideas</h1><p>Draw a shape, add a project image, or embed a Canvas.<br>Your design lives in a file your agent can read.</p><button id="first-shape">Create a rectangle</button></div>
    <div id="error" hidden><h2>Unable to display this Canvas</h2><p id="error-message"></p><button id="error-source">Open JSON source</button></div>
    <div class="statusbar"><span id="hint">Drag to move · Scroll to pan · Pinch to zoom</span><div class="status-actions"><button id="export-screenshot" title="Export full Canvas as PNG" aria-label="Export Canvas screenshot">Export PNG</button><button id="source" title="Open JSON source" aria-label="Open JSON source">&lt;/&gt;</button><div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-label">100%</span><button id="zoom-in" aria-label="Zoom in">+</button><button id="fit" title="Fit all nodes (F)">Fit</button></div></div></div>
    <div id="toast" role="status" hidden></div>
  </main><aside id="details-sidebar" class="inspector" aria-label="Details sidebar">
    <section id="details-panel"><div class="panel-heading"><span>Details</span><span id="selection-count"></span><button id="hide-details" class="sidebar-button panel-collapse" title="Hide Details" aria-label="Hide Details" aria-controls="details-sidebar" aria-expanded="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m10 7 5 5-5 5"/></svg></button></div><div id="properties"></div></section>
  </aside></div>`;
const stage = document.getElementById('stage')!;
const properties = document.getElementById('properties')!;
const outliner = document.getElementById('outliner')!;
const sceneRoot = document.getElementById('scene-root')!;
const fileInsertions = new Map<string, number>();

function canInsertFiles() { return loaded && !invalid && !session.hasPendingEdits && !inspectorPreview; }
function requestFileInsertion(message: Record<string, unknown>) {
  if (!canInsertFiles()) { notice('Finish the current edit and open a valid Canvas before adding files.'); return; }
  const requestId = uid();
  fileInsertions.set(requestId, version);
  post({ ...message, requestId, baseVersion: version });
}
enableFileDrop(stage, {
  enabled: canInsertFiles,
  drop(uris, clientX, clientY) { const p = point(clientX, clientY); requestFileInsertion({ type: 'prepareFileNodes', uris, x: Math.round(p.x), y: Math.round(p.y) }); },
  notice,
});

function post(message: unknown) { vscode.postMessage(message); }
function uid(): string { return crypto.randomUUID(); }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(message: string) {
  const toast = document.getElementById('toast')!;
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
function point(clientX: number, clientY: number) {
  const rect = stage.getBoundingClientRect();
  return { x: (clientX - rect.left - camera.x) / camera.zoom, y: (clientY - rect.top - camera.y) / camera.zoom };
}
function center() {
  const rect = stage.getBoundingClientRect();
  return point(rect.left + rect.width / 2, rect.top + rect.height / 2);
}
function updateCamera() {
  document.getElementById('zoom-label')!.textContent = `${Math.round(camera.zoom * 100)}%`;
  persistState();
}
function persistState() { vscode.setState({ ...camera, collapsed: [...collapsed], expandedReferences: [...expandedReferences], outlinerHidden: sidebarHidden.outliner, detailsHidden: sidebarHidden.details }); }
function renderSidebarVisibility() {
  for (const side of ['outliner', 'details'] as const) {
    const hidden = sidebarHidden[side];
    document.getElementById(`${side}-sidebar`)!.hidden = hidden;
    document.getElementById(`show-${side}`)!.hidden = !hidden;
    stage.dataset[`${side}Hidden`] = String(hidden);
    for (const action of ['hide', 'show']) {
      document.getElementById(`${action}-${side}`)!.setAttribute('aria-expanded', String(!hidden));
    }
  }
}
function setSidebarHidden(side: 'outliner' | 'details', hidden: boolean) {
  sidebarHidden[side] = hidden;
  renderSidebarVisibility();
  persistState();
  document.getElementById(`${hidden ? 'show' : 'hide'}-${side}`)!.focus();
}
function fit() { renderer.fit(); }
function zoom(factor: number) { renderer.zoom(factor); }
function setTool(value: Tool) {
  tool = value;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.classList.toggle('active', button.dataset.tool === value);
    button.setAttribute('aria-pressed', String(button.dataset.tool === value));
  }
  stage.dataset.tool = value;
  updateRenderer();
  document.getElementById('hint')!.textContent = value === 'connect' ? 'Drag a node handle to another node to connect' : ['rectangle', 'ellipse', 'text', 'html', 'group'].includes(value) ? 'Click or drag on the canvas to create' : 'Shift + click to select multiple · Scroll to pan · Pinch to zoom';
}

function disposeNumberFields() {
  const disposers = numberFieldDisposers;
  numberFieldDisposers = [];
  for (const dispose of disposers) dispose();
}
function rebuild() { disposeNumberFields(); data = session.preview(); }
function commit(operation: Operation) {
  if (invalid || version < 0) return;
  try { session.enqueue(uid(), operation); rebuild(); render(); pump(); }
  catch (error) { notice((error as Error).message); }
}
function pump() { const request = session.next(); if (request) post(request); }
let screenshotBusy = false;
async function exportScreenshot(request: { requestId: string; version: number }) {
  const button = document.getElementById('export-screenshot') as HTMLButtonElement;
  const snapshot = data;
  if (screenshotBusy) {
    post({ type: 'screenshotResult', requestId: request.requestId, error: 'Another screenshot is being exported.' });
    return;
  }
  try {
    if (invalid || request.version !== version) throw new Error('The Canvas is not ready for export.');
    if (session.hasPendingEdits || inspectorPreview) throw new Error('Finish the current edit before exporting.');
    screenshotBusy = true;
    button.disabled = true;
    const dataUrl = await captureCanvas(document.getElementById('flow')!, snapshot);
    if (snapshot !== data || request.version !== version || inspectorPreview) throw new Error('The Canvas changed during export. Please export again.');
    post({ type: 'screenshotResult', requestId: request.requestId, version, dataUrl });
  } catch (error) {
    post({ type: 'screenshotResult', requestId: request.requestId, error: (error as Error).message });
  } finally { screenshotBusy = false; button.disabled = invalid; }
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'insertFiles') {
    const p = center();
    requestFileInsertion({ type: 'prepareFileNodes', uris: message.uris, x: Math.round(p.x - 210), y: Math.round(p.y - 150) });
  } else if (message.type === 'fileNodes') {
    const baseVersion = fileInsertions.get(message.requestId);
    fileInsertions.delete(message.requestId);
    if (baseVersion === undefined) return;
    if (message.error) { notice(message.error); return; }
    if (!Array.isArray(message.nodes) || !message.nodes.length) return;
    if (baseVersion !== version || message.baseVersion !== version || !canInsertFiles()) { notice('The Canvas changed. Add the files again.'); return; }
    selection = new Set(message.nodes.map((node: CanvasNode) => node.id)); selectedEdge = undefined;
    setTool('select');
    commit({ type: 'addNodes', nodes: message.nodes });
  } else if (message.type === 'captureScreenshot') {
    void exportScreenshot(message);
  } else if (message.type === 'state') {
    const state = message as CanvasState;
    if (state.version < version) return;
    version = state.version; invalid = !!state.error;
    documentUri = state.uri;
    (document.getElementById('export-screenshot') as HTMLButtonElement).disabled = invalid || screenshotBusy;
    stage.setAttribute('aria-label', `Design canvas: ${state.name}`);
    document.getElementById('error')!.hidden = !invalid;
    document.getElementById('error-message')!.textContent = state.error ?? '';
    document.getElementById('flow')!.hidden = invalid;
    for (const button of document.querySelectorAll<HTMLButtonElement>('.toolbar button')) button.disabled = invalid;
    const conflict = session.receive(state.version, state.data ?? { nodes: [], edges: [] });
    if (conflict) notice(conflict);
    assets = state.assets ?? {};
    rebuild(); render();
    if (!loaded && state.data) { loaded = true; if (!saved) fit(); }
    pump();
  } else if (message.type === 'ack') {
    const error = session.acknowledge(message.requestId, message);
    if (error) notice(error);
    rebuild(); render();
    if (session.needsState) post({ type: 'ready' });
    else pump();
  } else if (message.type === 'notice') notice(message.message);
});

function updateRenderer() {
  if (!renderer) return;
  renderer.update({ data: inspectorPreview ? applyOperation(data, inspectorPreview) : data, assets, selected: new Set(selection), tool, version, invalid, documentUri,
    onSelect(ids) {
      if (ids.length === selection.size && ids.every(id => selection.has(id))) return;
      selection = new Set(ids); selectedEdge = undefined; syncSelection(true);
    },
    onEdgeSelect(id) { selectedEdge = id; selection.clear(); syncSelection(); },
    onCommit: commit, onOpen: id => post({ type: 'openNode', id }), onNotice: notice,
    onViewport(viewport) { camera = viewport; updateCamera(); },
    onCreate(kind, x, y, width, height) { addShape(kind as Tool, x, y, width, height); setTool('select'); },
    onRendered: reportRendered,
  });
}
function render() {
  selection = new Set([...selection].filter(id => data.nodes.some(node => node.id === id)));
  updateRenderer(); renderOutliner(); renderInspector();
  document.getElementById('empty')!.hidden = invalid || data.nodes.length > 0;
  document.getElementById('node-count')!.textContent = `${data.nodes.length} object${data.nodes.length === 1 ? '' : 's'}`;
  updateCamera();
}
function reportRendered() {
  post({ type: 'rendered', nodeCount: data.nodes.length, htmlCount: [...stage.querySelectorAll<HTMLElement>('.html-preview')].filter(host => host.shadowRoot?.childElementCount).length, nestedCount: stage.querySelectorAll('.embedded-canvas').length, loadedImages: [...stage.querySelectorAll<HTMLImageElement>('.project-image')].filter(image => image.complete && image.naturalWidth > 0).length, invalid });
}
function syncSelection(expandParents = false) {
  let expanded = false;
  if (expandParents) {
    const hierarchy = getHierarchy(data.nodes);
    for (const id of selection) {
      let parent = hierarchy.parents.get(id);
      while (parent) { expanded = collapsed.delete(parent) || expanded; parent = hierarchy.parents.get(parent); }
    }
  }
  updateRenderer();
  if (expanded) { persistState(); renderOutliner(); }
  for (const row of outliner.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const selected = selection.has(row.dataset.nodeId!);
    row.classList.toggle('selected', selected); row.setAttribute('aria-selected', String(selected));
  }
  renderInspector();
}
function selectNode(id: string, additive = false) {
  if (invalid) return;
  if (additive) selection.has(id) ? selection.delete(id) : selection.add(id);
  else selection = new Set([id]);
  selectedEdge = undefined; syncSelection(true);
}
function clearDropMarks() {
  for (const row of document.querySelectorAll('.drop-before, .drop-after, .drop-inside')) row.classList.remove('drop-before', 'drop-after', 'drop-inside');
}
function dropPosition(event: DragEvent, row: HTMLElement, node: CanvasNode): MoveNode['placement'] {
  const rect = row.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
  return node.type === 'group' && ratio >= 0.25 && ratio <= 0.75 ? 'inside' : ratio < 0.5 ? 'before' : 'after';
}
function validDrop(target: CanvasNode | undefined): boolean {
  return !!draggedNode && (!target || !descendantIds(getHierarchy(data.nodes), draggedNode.id).has(target.id));
}
function finishDrop(move: MoveNode) {
  if (!draggedNode || draggedNode.version !== version) { notice('The file changed; please drag the node again.'); return; }
  try {
    applyOperation(data, move);
    selection = new Set([move.id]); selectedEdge = undefined;
    if (move.placement === 'inside' && move.targetId) collapsed.delete(move.targetId);
    commit(move); persistState();
  } catch (error) { notice((error as Error).message); }
  finally { draggedNode = undefined; clearDropMarks(); }
}
function iconFor(node: CanvasNode): string {
  return isHtmlNode(node) ? '<>' : node.type === 'group' ? '▤' : node.type === 'file' ? /\.canvas$/i.test(node.file ?? '') ? '⊞' : '▧' : node.type === 'link' ? '↗' : node.canvasDesign?.shape === 'ellipse' ? '○' : node.text ? 'T' : '▢';
}
function renderOutliner() {
  const scroll = outliner.scrollTop;
  const focusId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
  outliner.replaceChildren();
  if (invalid) return;
  if (!data.nodes.length) outliner.append(element('p', 'outliner-empty', 'No objects'));
  const hierarchy = getHierarchy(data.nodes);
  const appendReferenced = (preview: AssetPreview, ownerId: string, depth: number, prefix: string) => {
    if (!preview.canvas) return;
    const tree = getHierarchy(preview.canvas.nodes);
    const append = (parentId: string | null, level: number) => {
      for (const node of [...(tree.children.get(parentId) ?? [])].reverse()) {
        const row = element('div', 'outliner-row referenced'); row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(level + 1)); row.setAttribute('aria-disabled', 'true');
        row.style.paddingLeft = `${10 + level * 16}px`;
        row.append(element('span', 'tree-chevron', '·'), element('span', 'tree-icon', iconFor(node)), element('span', 'tree-label', nodeName(node)), element('span', 'reference-badge', '↗'));
        row.title = 'Referenced content. Double-click to edit the source Canvas.';
        row.addEventListener('click', () => selectNode(ownerId)); row.addEventListener('dblclick', () => post({ type: 'openNode', id: ownerId }));
        outliner.append(row); append(node.id, level + 1);
        const nested = preview.assets?.[node.id];
        if (nested?.canvas && level < 12) appendReferenced(nested, ownerId, level + 1, `${prefix}/${node.id}`);
      }
    };
    append(null, depth);
  };
  const append = (parentId: string | null, depth: number) => {
    const siblings = [...(hierarchy.children.get(parentId) ?? [])].reverse();
    siblings.forEach((node, index) => {
      const children = hierarchy.children.get(node.id) ?? [];
      const reference = assets[node.id]?.canvas ? assets[node.id] : undefined;
      const expandable = children.length > 0 || !!reference;
      const open = reference ? expandedReferences.has(node.id) : !collapsed.has(node.id);
      const row = element('div', `outliner-row${selection.has(node.id) ? ' selected' : ''}`);
      row.dataset.nodeId = node.id; row.draggable = true; row.tabIndex = selection.has(node.id) || !selection.size && index === 0 && depth === 0 ? 0 : -1;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.setAttribute('aria-selected', String(selection.has(node.id))); row.setAttribute('aria-posinset', String(index + 1)); row.setAttribute('aria-setsize', String(siblings.length));
      if (expandable) row.setAttribute('aria-expanded', String(open));
      row.style.paddingLeft = `${10 + depth * 16}px`; row.title = `${nodeName(node)} · ${node.id}`;
      const toggle = element('button', 'tree-chevron', expandable ? open ? '⌄' : '›' : '');
      toggle.tabIndex = -1; toggle.disabled = !expandable; toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${nodeName(node)}`);
      toggle.onclick = event => {
        event.stopPropagation();
        if (reference) open ? expandedReferences.delete(node.id) : expandedReferences.add(node.id);
        else open ? collapsed.add(node.id) : collapsed.delete(node.id);
        persistState(); renderOutliner();
      };
      row.append(toggle, element('span', 'tree-icon', iconFor(node)), element('span', 'tree-label', nodeName(node)));
      if (reference) row.append(element('span', 'reference-badge', '↗'));
      row.addEventListener('click', event => selectNode(node.id, event.shiftKey));
      row.addEventListener('dblclick', () => { if (node.type === 'file' || node.type === 'link') post({ type: 'openNode', id: node.id }); });
      row.addEventListener('dragstart', event => {
        if ((event.target as HTMLElement).closest('button') || !event.dataTransfer) { event.preventDefault(); return; }
        draggedNode = { id: node.id, version }; row.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-canvas-node', node.id);
      });
      row.addEventListener('dragover', event => {
        event.stopPropagation(); clearDropMarks();
        if (!validDrop(node)) return;
        event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        row.classList.add(`drop-${dropPosition(event, row, node)}`);
      });
      row.addEventListener('drop', event => {
        event.preventDefault(); event.stopPropagation();
        if (validDrop(node)) finishDrop({ type: 'moveNode', id: draggedNode!.id, targetId: node.id, placement: dropPosition(event, row, node) });
      });
      row.addEventListener('dragend', () => { draggedNode = undefined; row.classList.remove('dragging'); clearDropMarks(); });
      row.addEventListener('keydown', event => {
        const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '];
        if (!keys.includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
          if (target) commit({ type: 'moveNode', id: node.id, targetId: target.id, placement: event.key === 'ArrowUp' ? 'before' : 'after' });
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          if (expandable && open === (event.key === 'ArrowLeft')) { toggle.click(); return; }
          const targetId = event.key === 'ArrowLeft' ? parentId : children.at(-1)?.id;
          if (targetId) focusOutlinerNode(targetId);
          return;
        }
        const rows = [...outliner.querySelectorAll<HTMLElement>('[data-node-id]')];
        const position = rows.indexOf(row);
        const next = event.key === 'Home' ? rows[0] : event.key === 'End' ? rows.at(-1) : event.key === 'ArrowUp' ? rows[position - 1] : event.key === 'ArrowDown' ? rows[position + 1] : row;
        if (next) { selectNode(next.dataset.nodeId!, event.shiftKey && next === row); next.focus(); }
      });
      outliner.append(row);
      if (open) { append(node.id, depth + 1); if (reference) appendReferenced(reference, node.id, depth + 1, node.id); }
    });
  };
  append(null, 0);
  outliner.scrollTop = scroll;
  if (focusId) focusOutlinerNode(focusId, false);
}
function focusOutlinerNode(id: string, select = true) {
  if (select) selectNode(id);
  [...outliner.querySelectorAll<HTMLElement>('[data-node-id]')].find(row => row.dataset.nodeId === id)?.focus();
}
sceneRoot.onclick = () => { selection.clear(); selectedEdge = undefined; syncSelection(); };
sceneRoot.addEventListener('dragover', event => {
  clearDropMarks(); if (!validDrop(undefined)) return;
  event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; sceneRoot.classList.add('drop-inside');
});
sceneRoot.addEventListener('drop', event => {
  event.preventDefault(); if (draggedNode) finishDrop({ type: 'moveNode', id: draggedNode.id, targetId: null, placement: 'inside' });
});
function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  operation: (value: number) => Operation,
): HTMLElement {
  const row = element('label', 'field');
  row.append(element('span', 'field-label', label));
  const input = element('input');
  input.type = 'number';
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.addEventListener('change', () => {
    const next = input.valueAsNumber;
    if (!Number.isFinite(next)) {
      input.value = String(value);
      return;
    }
    commit(operation(Math.max(min, Math.min(max, next))));
  });
  numberFieldDisposers.push(enableNumberScrub(input, {
    preview(next) {
      inspectorPreview = operation(next);
      updateRenderer();
    },
    commit(next) {
      inspectorPreview = undefined;
      commit(operation(next));
    },
    cancel() {
      inspectorPreview = undefined;
      updateRenderer();
    },
  }));
  row.append(input);
  return row;
}
function renderInspector() {
  disposeNumberFields();
  const inspectedNode = !invalid && selection.size === 1 ? data.nodes.find(item => selection.has(item.id)) : undefined;
  syncColorPickerOwner(inspectedNode && !isFramelessFileNode(inspectedNode) ? inspectedNode.id : undefined);
  properties.replaceChildren();
  document.getElementById('selection-count')!.textContent = selection.size > 1 ? `${selection.size} selected` : '';
  if (!selection.size || invalid) {
    properties.append(element('p', 'muted', invalid ? 'Fix the Canvas source to inspect objects.' : 'Select an object on the canvas or in the Outliner to edit its properties.'));
    return;
  }
  if (selection.size > 1) {
    properties.append(element('h3', 'property-title', `${selection.size} objects selected`), element('p', 'muted', 'Drag to move together. Use Delete to remove, or Ctrl/Cmd + D to duplicate.')); return;
  }
  const node = inspectedNode!;
  const style = getStyle(node);
  const patch = (fields: Partial<CanvasNode>) => commit({ type: 'updateNodes', updates: [{ id: node.id, patch: fields }] });
  const numeric = (label: string, value: number, min: number, max: number, fields: (value: number) => Partial<CanvasNode>) =>
    numberField(label, value, min, max, next => ({ type: 'updateNodes', updates: [{ id: node.id, patch: fields(next) }] }));
  properties.append(element('h3', 'property-title', nodeName(node)));
  const coordinates = element('div', 'field-grid');
  for (const [key, label] of [['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H']] as const) {
    coordinates.append(numeric(label, Math.round(node[key]), key === 'width' || key === 'height' ? 20 : -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, value => ({ [key]: Math.round(value) })));
  }
  properties.append(coordinates);
  if (!isFramelessFileNode(node)) {
    properties.append(element('h4', 'section-title', 'Appearance'));
    properties.append(
      colorField(node.id, 'Fill', style.fill, value => patch({ canvasDesign: { fill: value } })),
      colorField(node.id, 'Stroke', style.stroke, value => patch({ canvasDesign: { stroke: value } })),
    );
    if (style.shape !== 'ellipse') properties.append(numeric('Corner radius', style.radius, 0, 256, value => ({ canvasDesign: { radius: value } })));
  }
  if (isHtmlNode(node)) {
    const editVersion = version;
    for (const [key, label] of [['html', 'HTML'], ['css', 'CSS'], ['text', 'Fallback text']] as const) {
      properties.append(element('h4', 'section-title', label));
      const input = element('textarea', key === 'text' ? 'content-input' : 'content-input code-input');
      const value = key === 'text' ? node.text : node.canvasDesign?.[key];
      input.value = typeof value === 'string' ? value : '';
      input.setAttribute('aria-label', label);
      input.spellcheck = false;
      input.addEventListener('change', () => {
        if (version !== editVersion) { notice('The file changed; HTML edit cancelled.'); return; }
        patch(key === 'text' ? { text: input.value } : { canvasDesign: { [key]: input.value } });
      });
      properties.append(input);
    }
    properties.append(element('p', 'muted', 'Static HTML and CSS. Changes apply when you leave the field. Fallback text is shown by other Canvas readers.'));
  }
  if (node.type === 'text' && !isHtmlNode(node)) properties.append(numeric('Font size', style.fontSize, 1, 256, value => ({ canvasDesign: { fontSize: value } })));
  if (node.type === 'group' || node.type === 'text' && !isHtmlNode(node)) {
    properties.append(element('h4', 'section-title', node.type === 'group' ? 'Label' : 'Content'));
    const input = element('textarea', 'content-input'); input.value = node.type === 'text' ? node.text ?? '' : node.label ?? ''; input.setAttribute('aria-label', 'Content');
    input.addEventListener('change', () => patch(node.type === 'text' ? { text: input.value } : { label: input.value })); properties.append(input);
  }
  if (node.type === 'file' || node.type === 'link') {
    properties.append(element('h4', 'section-title', node.type === 'file' ? 'File path' : 'URL'));
    const input = element('input', 'reference-input'); input.value = node.file ?? node.url ?? ''; input.setAttribute('aria-label', 'Reference');
    input.addEventListener('change', () => patch(node.type === 'file' ? { file: input.value } : { url: input.value })); properties.append(input);
    const open = element('button', 'secondary-button', 'Open referenced file'); open.onclick = () => post({ type: 'openNode', id: node.id }); properties.append(open);
  }
  const id = element('p', 'node-id', `ID: ${node.id}`); properties.append(id);
  const remove = element('button', 'danger-button', 'Delete object'); remove.onclick = removeSelection; properties.append(remove);
}

function addShape(kind: Tool, x: number, y: number, width: number, height: number) {
  const id = uid(); selection = new Set([id]); selectedEdge = undefined;
  const node: CanvasNode = { id, type: kind === 'group' ? 'group' : 'text', x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  if (kind === 'group') node.label = 'Group';
  else if (kind === 'html') { node.text = 'HTML card'; node.canvasDesign = { type: 'html', html: defaultHtml, css: defaultCss, radius: 12 }; }
  else { node.text = kind === 'text' ? 'Double-click to edit' : ''; node.canvasDesign = { shape: kind === 'ellipse' ? 'ellipse' : 'rectangle', fill: kind === 'ellipse' ? '#eee9ff' : '#ffffff', stroke: '#b6a7ef', radius: kind === 'text' ? 0 : 16, fontSize: 16 }; }
  commit({ type: 'addNodes', nodes: [node], prepend: kind === 'group' });
}
function removeSelection() {
  if (selectedEdge) { const id = selectedEdge; selectedEdge = undefined; commit({ type: 'deleteEdge', id }); }
  else if (selection.size) { const ids = [...selection]; selection.clear(); commit({ type: 'deleteNodes', ids }); }
}
function duplicate() {
  const nodes = data.nodes.filter(node => selection.has(node.id)).map(node => ({ ...structuredClone(node), id: uid(), x: node.x + 24, y: node.y + 24 }));
  if (nodes.length) { selection = new Set(nodes.map(node => node.id)); commit({ type: 'addNodes', nodes }); }
}
window.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).closest('input, textarea')) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); post({ type: 'save' }); return; }
  if (mod && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); post({ type: event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo' }); return; }
  if (invalid) return;
  if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); return; }
  if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); selection = new Set(data.nodes.map(node => node.id)); render(); return; }
  if (mod) return;
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelection(); }
  if (event.key === 'Escape') { selection.clear(); selectedEdge = undefined; setTool('select'); render(); }
  const tools: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rectangle', o: 'ellipse', t: 'text', u: 'html', g: 'group', c: 'connect' };
  if (tools[event.key.toLowerCase()]) setTool(tools[event.key.toLowerCase()]);
  if (event.key.toLowerCase() === 'f') fit();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selection.size) {
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    commit({ type: 'updateNodes', updates: data.nodes.filter(node => selection.has(node.id)).map(node => ({ id: node.id, patch: { x: node.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: node.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) } })) });
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.onclick = () => setTool(button.dataset.tool as Tool);
for (const [id, kind] of [['image', 'image'], ['canvas', 'canvas'], ['file', 'file']]) document.getElementById(id)!.onclick = () => {
  const p = center(); requestFileInsertion({ type: 'insertFile', kind, x: Math.round(p.x - 210), y: Math.round(p.y - 150) });
};
document.getElementById('source')!.onclick = document.getElementById('error-source')!.onclick = () => post({ type: 'source' });
document.getElementById('export-screenshot')!.onclick = () => post({ type: 'exportScreenshot' });
document.getElementById('fit')!.onclick = fit;
document.getElementById('zoom-in')!.onclick = () => zoom(1.2);
document.getElementById('zoom-out')!.onclick = () => zoom(1 / 1.2);
document.getElementById('first-shape')!.onclick = () => { const p = center(); addShape('rectangle', p.x - 110, p.y - 70, 220, 140); };
for (const side of ['outliner', 'details'] as const) {
  document.getElementById(`hide-${side}`)!.onclick = () => setSidebarHidden(side, true);
  document.getElementById(`show-${side}`)!.onclick = () => setSidebarHidden(side, false);
}
renderSidebarVisibility();
renderer = createCanvasRenderer(document.getElementById('flow')!, camera);
setTool('select'); render(); post({ type: 'ready' });
