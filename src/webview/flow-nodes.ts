import type { Node } from '@xyflow/react';
import type { AssetPreview, CanvasNode } from '../shared/canvas';

export type StudioNode = Node<{ canvas: CanvasNode; asset?: AssetPreview }, 'canvas'>;

/** Keep React Flow's measurements when synchronizing source edits and live previews. */
export function syncFlowNodes(
  current: StudioNode[],
  nodes: CanvasNode[],
  assets: Record<string, AssetPreview>,
  selected: Set<string>,
  preservePositions = false,
): StudioNode[] {
  const previous = new Map(current.map((node) => [node.id, node]));
  return nodes.map((node, index) => {
    const before = previous.get(node.id);
    return {
      id: node.id,
      type: 'canvas',
      position: preservePositions && before ? before.position : { x: node.x, y: node.y },
      data: { canvas: node, asset: assets[node.id] },
      selected: selected.has(node.id),
      // CSS sizes alone don't count as known dimensions in React Flow. Without
      // these, each update hides every node until ResizeObserver measures it.
      width: node.width,
      height: node.height,
      measured: before?.measured,
      style: { width: node.width, height: node.height },
      zIndex: index,
    };
  });
}
