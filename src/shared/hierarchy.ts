import type { CanvasData, CanvasNode } from './canvas';

export interface Hierarchy {
  parents: Map<string, string | null>;
  children: Map<string | null, CanvasNode[]>;
}
export interface MoveNode {
  type: 'moveNode';
  id: string;
  targetId: string | null;
  placement: 'before' | 'after' | 'inside';
}

function contains(group: CanvasNode, node: CanvasNode): boolean {
  return group.id !== node.id && node.x >= group.x && node.y >= group.y && node.x + node.width <= group.x + group.width && node.y + node.height <= group.y + group.height;
}

/** JSON Canvas remains flat; absent parent metadata falls back to geometric groups. */
export function getHierarchy(nodes: CanvasNode[]): Hierarchy {
  const groups = nodes.filter(node => node.type === 'group');
  const groupIds = new Set(groups.map(group => group.id));
  const parents = new Map<string, string | null>();
  for (const node of nodes) {
    const explicit = node.canvasStudio?.parentId;
    if (explicit !== undefined) {
      parents.set(node.id, typeof explicit === 'string' && groupIds.has(explicit) && explicit !== node.id ? explicit : null);
      continue;
    }
    const candidates = groups.filter(group => contains(group, node) && (node.type !== 'group' || group.width * group.height > node.width * node.height));
    candidates.sort((a, b) => a.width * a.height - b.width * b.height || nodes.indexOf(a) - nodes.indexOf(b));
    parents.set(node.id, candidates[0]?.id ?? null);
  }
  // Malformed extension metadata must not make a valid JSON Canvas unopenable.
  for (const node of nodes) {
    const chain: string[] = [];
    let id: string | null = node.id;
    while (id !== null) {
      const index = chain.indexOf(id);
      if (index !== -1) {
        for (const cyclicId of chain.slice(index)) parents.set(cyclicId, null);
        break;
      }
      chain.push(id); id = parents.get(id) ?? null;
    }
  }
  const children = new Map<string | null, CanvasNode[]>([[null, []]]);
  for (const node of nodes) {
    const parent = parents.get(node.id) ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(node);
  }
  return { parents, children };
}

export function descendantIds(hierarchy: Hierarchy, id: string): Set<string> {
  const result = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    for (const child of hierarchy.children.get(current) ?? []) pending.push(child.id);
  }
  return result;
}

/** Outliner order is front-to-back, the reverse of the standard nodes z-order. */
export function moveNode(data: CanvasData, move: MoveNode): CanvasData {
  const hierarchy = getHierarchy(data.nodes);
  const node = data.nodes.find(item => item.id === move.id);
  if (!node) throw new Error('The dragged node no longer exists.');
  const target = data.nodes.find(item => item.id === move.targetId);
  if (move.targetId !== null && !target) throw new Error('The drop target no longer exists.');
  if (!['before', 'after', 'inside'].includes(move.placement)) throw new Error('Invalid drop position.');
  if (move.targetId === null && move.placement !== 'inside') throw new Error('Drop root nodes into Scene.');
  if (move.placement === 'inside' && target && target.type !== 'group') throw new Error('Only groups can contain nodes.');
  const movingIds = descendantIds(hierarchy, move.id);
  if (target && movingIds.has(target.id)) throw new Error('A node cannot be moved into itself or its descendants.');
  const parentId = move.placement === 'inside' ? move.targetId : hierarchy.parents.get(move.targetId!) ?? null;
  const result = structuredClone(data);
  // Freeze inferred relationships during a layer move, so geometry cannot undo a reparent.
  for (const item of result.nodes) item.canvasStudio = { ...item.canvasStudio, parentId: item.id === move.id ? parentId : hierarchy.parents.get(item.id) ?? null };
  const moving = result.nodes.filter(item => movingIds.has(item.id));
  const remaining = result.nodes.filter(item => !movingIds.has(item.id));
  // A moved group must remain behind its children, including files with arbitrary z-order.
  moving.sort((a, b) => a.id === move.id ? -1 : b.id === move.id ? 1 : 0);
  let index = remaining.length;
  if (target) {
    const targetIds = descendantIds(hierarchy, target.id);
    const indices = remaining.flatMap((item, position) => targetIds.has(item.id) ? [position] : []);
    index = move.placement === 'after' ? Math.min(...indices) : Math.max(...indices) + 1;
  }
  remaining.splice(index, 0, ...moving);
  result.nodes = remaining;
  return result;
}

export function nodeName(node: CanvasNode): string {
  const label = node.type === 'group' ? node.label : node.type === 'file' ? node.file?.split('/').pop() : node.type === 'link' ? node.url : node.text?.split('\n').find(line => line.trim());
  return label?.trim() || (node.type === 'text' ? node.canvasStudio?.shape === 'ellipse' ? 'Ellipse' : 'Rectangle' : node.type === 'group' ? 'Group' : 'File');
}
