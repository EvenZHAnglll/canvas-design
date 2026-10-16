import { parseHexColor } from './colors';

export type NodeType = 'text' | 'file' | 'link' | 'group';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface DesignStyle {
  type?: string;
  html?: string;
  css?: string;
  shape?: 'rectangle' | 'ellipse';
  fill?: string;
  stroke?: string;
  radius?: number;
  fontSize?: number;
  parentId?: string | null;
  [key: string]: unknown;
}
export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
  canvasStudio?: DesignStyle;
  [key: string]: unknown;
}
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  fromEnd?: 'none' | 'arrow';
  toEnd?: 'none' | 'arrow';
  label?: string;
  color?: string;
  [key: string]: unknown;
}
export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [key: string]: unknown;
}
export type Operation =
  | MoveNode
  | { type: 'batch'; operations: Operation[] }
  | { type: 'addNodes'; nodes: CanvasNode[]; prepend?: boolean }
  | { type: 'updateNodes'; updates: { id: string; patch: Partial<CanvasNode> }[] }
  | { type: 'deleteNodes'; ids: string[] }
  | { type: 'addEdge'; edge: CanvasEdge }
  | { type: 'deleteEdge'; id: string };
export interface AssetPreview {
  uri?: string;
  error?: string;
  canvas?: CanvasData;
  assets?: Record<string, AssetPreview>;
}
export interface CanvasState {
  type: 'state';
  version: number;
  name: string;
  data?: CanvasData;
  assets?: Record<string, AssetPreview>;
  error?: string;
}

const sides = ['top', 'right', 'bottom', 'left'];
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function fail(message: string): never { throw new Error(message); }
function colorValid(value: unknown): boolean {
  return value === undefined || typeof value === 'string' && (/^[1-6]$/.test(value) || /^#[\da-f]{6}$/i.test(value));
}

export function parseCanvas(source: string): CanvasData {
  let data: unknown;
  try { data = JSON.parse(source); } catch (error) { return fail(`Invalid JSON: ${(error as Error).message}`); }
  if (!object(data)) fail('Canvas must be a JSON object.');
  // JSON Canvas permits omitted nodes/edges; materialize empty arrays for editing.
  if (data.nodes === undefined) data.nodes = [];
  if (data.edges === undefined) data.edges = [];
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) fail('nodes and edges must be arrays.');
  const ids = new Set<string>();
  for (const [index, item] of data.nodes.entries()) {
    if (!object(item)) fail(`Node ${index + 1} must be an object.`);
    const name = `Node ${index + 1}`;
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail(`${name} needs a unique id.`);
    ids.add(item.id);
    if (!['text', 'file', 'link', 'group'].includes(item.type as string)) fail(`${name} has an unsupported type.`);
    for (const key of ['x', 'y', 'width', 'height']) {
      if (typeof item[key] !== 'number' || !Number.isSafeInteger(item[key])) fail(`${name}.${key} must be a safe integer.`);
    }
    if ((item.width as number) <= 0 || (item.height as number) <= 0) fail(`${name} dimensions must be positive.`);
    const content = { text: 'text', file: 'file', link: 'url' }[item.type as 'text' | 'file' | 'link'];
    if (content && typeof item[content] !== 'string') fail(`${name}.${content} must be a string.`);
    for (const key of ['label', 'background', 'subpath']) if (item[key] !== undefined && typeof item[key] !== 'string') fail(`${name}.${key} must be a string.`);
    if (item.subpath !== undefined && !(item.subpath as string).startsWith('#')) fail(`${name}.subpath must start with #.`);
    if (item.backgroundStyle !== undefined && !['cover', 'ratio', 'repeat'].includes(item.backgroundStyle as string)) fail(`${name}.backgroundStyle is invalid.`);
    if (!colorValid(item.color)) fail(`${name}.color must be 1–6 or a six-digit hex color.`);
    if (item.canvasStudio !== undefined && !object(item.canvasStudio)) fail(`${name}.canvasStudio must be an object.`);
  }
  const edgeIds = new Set<string>();
  for (const [index, item] of data.edges.entries()) {
    if (!object(item)) fail(`Edge ${index + 1} must be an object.`);
    if (typeof item.id !== 'string' || !item.id || edgeIds.has(item.id)) fail(`Edge ${index + 1} needs a unique id.`);
    edgeIds.add(item.id);
    if (typeof item.fromNode !== 'string' || typeof item.toNode !== 'string') fail(`Edge ${item.id} endpoints must be strings.`);
    if (!ids.has(item.fromNode as string) || !ids.has(item.toNode as string)) fail(`Edge ${item.id} references a missing node.`);
    for (const key of ['fromSide', 'toSide']) if (item[key] !== undefined && !sides.includes(item[key] as string)) fail(`Edge ${item.id}.${key} is invalid.`);
    for (const key of ['fromEnd', 'toEnd']) if (item[key] !== undefined && !['none', 'arrow'].includes(item[key] as string)) fail(`Edge ${item.id}.${key} is invalid.`);
    if (!colorValid(item.color)) fail(`Edge ${item.id}.color is invalid.`);
    if (item.label !== undefined && typeof item.label !== 'string') fail(`Edge ${item.id}.label must be a string.`);
  }
  return data as unknown as CanvasData;
}

export function applyOperation(data: CanvasData, operation: Operation): CanvasData {
  const result = structuredClone(data);
  switch (operation.type) {
    case 'addNodes':
      if (operation.prepend) result.nodes.unshift(...operation.nodes);
      else result.nodes.push(...operation.nodes);
      break;
    case 'updateNodes':
      for (const { id, patch } of operation.updates) {
        const node = result.nodes.find(item => item.id === id);
        if (!node) fail(`Node ${id} no longer exists.`);
        const { id: ignoredId, canvasStudio, ...fields } = patch;
        Object.assign(node, fields);
        if (canvasStudio) node.canvasStudio = { ...node.canvasStudio, ...canvasStudio };
      }
      break;
    case 'deleteNodes': {
      const hierarchy = getHierarchy(result.nodes);
      const deleted = new Set(operation.ids.flatMap(id => [...descendantIds(hierarchy, id)]));
      result.nodes = result.nodes.filter(node => !deleted.has(node.id));
      result.edges = result.edges.filter(edge => !deleted.has(edge.fromNode) && !deleted.has(edge.toNode));
      break;
    }
    case 'addEdge': result.edges.push(operation.edge); break;
    case 'deleteEdge': result.edges = result.edges.filter(edge => edge.id !== operation.id); break;
    case 'moveNode': return parseCanvas(JSON.stringify(moveNode(result, operation)));
    case 'batch': return operation.operations.reduce((current, item) => applyOperation(current, item), result);
    default: fail('Unknown edit operation.');
  }
  return parseCanvas(JSON.stringify(result));
}

export function serializeCanvas(data: CanvasData, previous: string): string {
  const match = previous.match(/\n([\t ]+)\S/);
  const indent = match?.[1] ?? '  ';
  const newline = previous.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(data, null, indent).replace(/\n/g, newline) + (previous.endsWith('\n') ? newline : '');
}

export function bounds(nodes: CanvasNode[]): { x: number; y: number; width: number; height: number } {
  if (!nodes.length) return { x: 0, y: 0, width: 800, height: 600 };
  const x = Math.min(...nodes.map(node => node.x));
  const y = Math.min(...nodes.map(node => node.y));
  const right = Math.max(...nodes.map(node => node.x + node.width));
  const bottom = Math.max(...nodes.map(node => node.y + node.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** PNG and Canvas references display their own content without a surrounding card. */
export function isFramelessFileNode(node: CanvasNode): boolean {
  return node.type === 'file' && /\.(png|canvas)$/i.test(node.file ?? '');
}

export function getStyle(node: CanvasNode) {
  const palette = ['#ef6666', '#ed9f48', '#e4c65b', '#63bb8b', '#609be4', '#9a82db'];
  const base = node.color && (/^[1-6]$/.test(node.color) ? palette[Number(node.color) - 1] : node.color);
  const style = node.canvasStudio ?? {};
  const hex = (value: unknown, fallback: string) =>
    typeof value === 'string' && parseHexColor(value) ? value : fallback;
  const fill = hex(style.fill, node.type === 'group' ? '#e9edf5' : '#ffffff');
  const number = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : fallback;
  return {
    shape: style.shape === 'ellipse' ? 'ellipse' : 'rectangle',
    // Preserve legacy group translucency; explicit alpha is used as authored.
    fill: node.type === 'group' && fill.length === 7 ? `${fill}50` : fill,
    stroke: hex(style.stroke, base || '#c9d2e2'),
    radius: number(style.radius, 12, 256),
    fontSize: number(style.fontSize, 16, 256),
  };
}
import { descendantIds, getHierarchy, moveNode, type MoveNode } from './hierarchy';

