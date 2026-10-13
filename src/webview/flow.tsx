import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, NodeResizer, ConnectionMode, MarkerType, applyNodeChanges, useReactFlow, type Node, type Edge, type NodeProps, type Viewport, type ReactFlowInstance, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { bounds, getStyle, type AssetPreview, type CanvasData, type CanvasNode, type Operation, type Side } from '../shared/canvas';
import { descendantIds, getHierarchy } from '../shared/hierarchy';

type StudioNode = Node<{ canvas: CanvasNode; asset?: AssetPreview }, 'canvas'>;
interface Options {
  data: CanvasData;
  assets: Record<string, AssetPreview>;
  selected: Set<string>;
  tool: string;
  version: number;
  invalid: boolean;
  onSelect(ids: string[]): void;
  onEdgeSelect(id: string): void;
  onCommit(operation: Operation): void;
  onOpen(id: string): void;
  onNotice(message: string): void;
  onViewport(viewport: Viewport): void;
  onCreate(tool: string, x: number, y: number, width: number, height: number): void;
  onRendered(): void;
}
const Actions = createContext<Options | null>(null);
const positions = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

function MiniCanvas({ preview }: { preview: AssetPreview }) {
  const canvas = preview.canvas!;
  const b = bounds(canvas.nodes);
  return <svg className="embedded-canvas" viewBox={`${b.x - 16} ${b.y - 16} ${b.width + 32} ${b.height + 32}`} preserveAspectRatio="xMidYMid meet">
    {canvas.edges.map(edge => {
      const a = canvas.nodes.find(node => node.id === edge.fromNode); const z = canvas.nodes.find(node => node.id === edge.toNode);
      return a && z ? <line key={edge.id} x1={a.x + a.width / 2} y1={a.y + a.height / 2} x2={z.x + z.width / 2} y2={z.y + z.height / 2} stroke="#8c9ab0" strokeWidth="2" /> : null;
    })}
    {canvas.nodes.map(node => {
      const style = getStyle(node); const asset = preview.assets?.[node.id];
      return <g key={node.id}>
        {style.shape === 'ellipse' ? <ellipse cx={node.x + node.width / 2} cy={node.y + node.height / 2} rx={node.width / 2} ry={node.height / 2} fill={style.fill} stroke={style.stroke} /> : <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={style.radius} fill={style.fill} fillOpacity={node.type === 'group' ? .3 : 1} stroke={style.stroke} />}
        {asset?.canvas ? <svg x={node.x + 8} y={node.y + 8} width={Math.max(1, node.width - 16)} height={Math.max(1, node.height - 16)}><MiniCanvas preview={asset} /></svg> : asset?.uri ? <image x={node.x} y={node.y} width={node.width} height={node.height} href={asset.uri} preserveAspectRatio="xMidYMid meet" /> : <foreignObject x={node.x} y={node.y} width={node.width} height={node.height}><div className={node.type === 'group' ? 'mini-label' : 'mini-text'} style={{ fontSize: style.fontSize }}>{node.text ?? node.label ?? node.file ?? node.url ?? ''}</div></foreignObject>}
      </g>;
    })}
  </svg>;
}

function DesignNode({ data, selected }: NodeProps<StudioNode>) {
  const actions = useContext(Actions)!;
  const node = data.canvas; const asset = data.asset; const style = getStyle(node);
  const [text, setText] = useState<string | undefined>();
  const editVersion = useRef(-1); const resizeVersion = useRef(-1);
  const finishText = (save: boolean) => {
    if (text === undefined) return;
    const value = text; setText(undefined);
    if (!save || value === (node.type === 'group' ? node.label ?? '' : node.text ?? '')) return;
    if (actions.version !== editVersion.current) { actions.onNotice('The file changed; text edit cancelled.'); return; }
    actions.onCommit({ type: 'updateNodes', updates: [{ id: node.id, patch: node.type === 'group' ? { label: value } : { text: value } }] });
  };
  useEffect(() => { if (text !== undefined && actions.version !== editVersion.current) setText(undefined); }, [actions.version]);
  const boxStyle = { backgroundColor: node.type === 'group' ? `${style.fill}50` : style.fill, borderColor: style.stroke, borderRadius: style.shape === 'ellipse' ? '50%' : style.radius, fontSize: style.fontSize };
  return <>
    <NodeResizer isVisible={selected && actions.tool === 'select' && text === undefined} minWidth={20} minHeight={20} color="var(--accent)" onResizeStart={() => { resizeVersion.current = actions.version; }} onResizeEnd={(_, size) => {
      if (actions.version !== resizeVersion.current) { actions.onNotice('The file changed; resize cancelled.'); return; }
      actions.onCommit({ type: 'updateNodes', updates: [{ id: node.id, patch: { x: Math.round(size.x), y: Math.round(size.y), width: Math.round(size.width), height: Math.round(size.height) } }] });
    }} />
    <div className={`flow-node ${node.type}${selected ? ' selected' : ''}`} style={boxStyle} onDoubleClick={event => {
      event.stopPropagation();
      if (node.type === 'text' || node.type === 'group') { editVersion.current = actions.version; setText(node.type === 'group' ? node.label ?? '' : node.text ?? ''); }
      else actions.onOpen(node.id);
    }}>
      {node.type === 'group' && <div className="group-label">{node.label || 'Group'}</div>}
      <div className="node-content" style={node.type === 'group' && asset?.uri ? { backgroundImage: `url("${asset.uri}")`, backgroundSize: node.backgroundStyle === 'repeat' ? 'auto' : node.backgroundStyle === 'ratio' ? 'contain' : 'cover', backgroundRepeat: node.backgroundStyle === 'repeat' ? 'repeat' : 'no-repeat' } : undefined}>
        {node.type === 'text' ? <div className="node-text">{node.text}</div> : node.type === 'group' ? null : asset?.canvas ? <MiniCanvas preview={asset} /> : asset?.uri ? <img className="project-image" src={asset.uri} alt={node.file} onLoad={actions.onRendered} onError={event => { event.currentTarget.alt = 'Unable to load image'; actions.onRendered(); }} /> : <><span className="file-symbol">{node.type === 'link' ? '↗' : '◇'}</span><div className="file-name">{node.file ?? node.url}</div><div className={asset?.error ? 'asset-error' : 'file-description'}>{asset?.error ?? 'Double-click to open'}</div></>}
      </div>
      {asset?.canvas && <div className="file-caption">⊞ {node.file?.split('/').pop()} · double-click to edit</div>}
      {text !== undefined && <textarea autoFocus className="inline-editor nodrag nowheel" value={text} onChange={event => setText(event.target.value)} onBlur={() => finishText(true)} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); finishText(false); }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finishText(true); }
      }} />}
    </div>
    {(Object.keys(positions) as Side[]).map(side => <Handle key={side} id={side} type="source" position={positions[side]} className={actions.tool === 'connect' ? 'connect-handle' : 'hidden-handle'} isConnectable={actions.tool === 'connect'} />)}
  </>;
}
const nodeTypes = { canvas: DesignNode };

function CanvasFlow({ options, initialViewport, initialized }: { options: Options; initialViewport: Viewport; initialized(instance: ReactFlowInstance<StudioNode, Edge>): void }) {
  const flow = useReactFlow<StudioNode, Edge>();
  const latest = useRef(options); latest.current = options;
  const drag = useRef<{ version: number; anchor: CanvasNode; originals: CanvasNode[] } | undefined>(undefined);
  const draw = useRef<{ x: number; y: number; version: number } | undefined>(undefined);
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number }>();
  const [nodes, setNodes] = useState<StudioNode[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drag.current && drag.current.version !== options.version) { drag.current = undefined; options.onNotice('The file changed; drag cancelled.'); }
    setNodes(current => options.data.nodes.map((node, index) => ({
      id: node.id, type: 'canvas', position: drag.current ? current.find(item => item.id === node.id)?.position ?? { x: node.x, y: node.y } : { x: node.x, y: node.y },
      data: { canvas: node, asset: options.assets[node.id] }, selected: options.selected.has(node.id),
      style: { width: node.width, height: node.height }, zIndex: index,
    })));
    requestAnimationFrame(options.onRendered);
  }, [options.data, options.assets, options.selected, options.version]);
  const onChanges = useCallback((changes: NodeChange<StudioNode>[]) => setNodes(current => applyNodeChanges(changes, current)), []);
  const onSelection = useCallback(({ nodes }: { nodes: StudioNode[] }) => latest.current.onSelect(nodes.map(node => node.id)), []);
  const edges: Edge[] = options.data.edges.map(edge => {
    const from = options.data.nodes.find(node => node.id === edge.fromNode); const to = options.data.nodes.find(node => node.id === edge.toNode);
    const right = (to?.x ?? 0) > (from?.x ?? 0);
    const color = getStyle({ id: '', type: 'text', x: 0, y: 0, width: 1, height: 1, color: edge.color }).stroke;
    return { id: edge.id, source: edge.fromNode, target: edge.toNode, sourceHandle: edge.fromSide ?? (right ? 'right' : 'left'), targetHandle: edge.toSide ?? (right ? 'left' : 'right'), label: edge.label, type: 'default', style: { stroke: color }, markerEnd: edge.toEnd === 'none' ? undefined : { type: MarkerType.ArrowClosed, color }, markerStart: edge.fromEnd === 'arrow' ? { type: MarkerType.ArrowClosed, color } : undefined, zIndex: options.data.nodes.length + 1 };
  });
  const drawing = ['rectangle', 'ellipse', 'text', 'group'].includes(options.tool) && !options.invalid;
  const screen = draft && flow.flowToScreenPosition({ x: draft.x, y: draft.y });
  const rect = wrapper.current?.getBoundingClientRect();
  return <Actions.Provider value={options}><div className="flow-wrapper" ref={wrapper}>
    <ReactFlow<StudioNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onChanges} onSelectionChange={onSelection} onInit={initialized} defaultViewport={initialViewport} minZoom={.08} maxZoom={4}
      // Trackpad scrolling pans in both axes; macOS pinch wheel events zoom separately.
      panOnScroll={true} panOnScrollSpeed={1} zoomOnScroll={false} zoomOnPinch={true}
      connectionMode={ConnectionMode.Loose} nodesDraggable={options.tool === 'select' && !options.invalid} nodesConnectable={options.tool === 'connect' && !options.invalid} elementsSelectable={!options.invalid && options.tool !== 'hand' && !drawing} panOnDrag={options.tool === 'hand' ? true : [1, 2]} panActivationKeyCode="Space" selectionOnDrag={options.tool === 'select'} multiSelectionKeyCode="Shift" deleteKeyCode={null} elevateNodesOnSelect={false} elevateEdgesOnSelect={false} onMove={(_, viewport) => options.onViewport(viewport)} onEdgeClick={(_, edge) => options.onEdgeSelect(edge.id)} onConnect={connection => {
      if (connection.source && connection.target) options.onCommit({ type: 'addEdge', edge: { id: crypto.randomUUID(), fromNode: connection.source, toNode: connection.target, fromSide: connection.sourceHandle as Side, toSide: connection.targetHandle as Side, toEnd: 'arrow' } });
    }} onNodeDragStart={(_, anchor, selectedNodes) => {
      const tree = getHierarchy(options.data.nodes); const ids = new Set<string>();
      for (const node of selectedNodes.length ? selectedNodes : [anchor]) for (const id of descendantIds(tree, node.id)) ids.add(id);
      const original = options.data.nodes.find(node => node.id === anchor.id)!;
      drag.current = { version: options.version, anchor: structuredClone(original), originals: structuredClone(options.data.nodes.filter(node => ids.has(node.id))) };
    }} onNodeDrag={(_, anchor) => {
      if (!drag.current) return;
      const { originals, anchor: before } = drag.current; const dx = anchor.position.x - before.x; const dy = anchor.position.y - before.y;
      setNodes(current => current.map(node => { const original = originals.find(item => item.id === node.id); return original ? { ...node, position: { x: original.x + dx, y: original.y + dy } } : node; }));
    }} onNodeDragStop={(_, anchor) => {
      const active = drag.current; drag.current = undefined;
      if (!active || active.version !== options.version) return;
      const dx = anchor.position.x - active.anchor.x; const dy = anchor.position.y - active.anchor.y;
      if (!dx && !dy) return;
      options.onCommit({ type: 'updateNodes', updates: active.originals.map(node => ({ id: node.id, patch: { x: Math.round(node.x + dx), y: Math.round(node.y + dy) } })) });
    }}><Background color="var(--canvas-grid)" gap={24} size={1} /></ReactFlow>
    {drawing && <div className="draw-layer" onPointerDown={event => { const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); draw.current = { ...p, version: options.version }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => {
      if (!draw.current) return; const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const start = draw.current;
      setDraft({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(start.x - p.x), height: Math.abs(start.y - p.y) });
    }} onPointerUp={event => {
      const start = draw.current; draw.current = undefined; setDraft(undefined);
      if (!start) return;
      if (start.version !== options.version) { options.onNotice('The file changed; drawing cancelled.'); return; }
      const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const moved = Math.abs(start.x - p.x) + Math.abs(start.y - p.y) > 4;
      options.onCreate(options.tool, moved ? Math.min(start.x, p.x) : start.x, moved ? Math.min(start.y, p.y) : start.y, moved ? Math.max(20, Math.abs(start.x - p.x)) : options.tool === 'group' ? 560 : 220, moved ? Math.max(20, Math.abs(start.y - p.y)) : options.tool === 'group' ? 400 : options.tool === 'text' ? 100 : options.tool === 'ellipse' ? 220 : 140);
    }} onPointerCancel={() => { draw.current = undefined; setDraft(undefined); }}>
      {draft && screen && rect && <div className={`draw-preview ${options.tool === 'ellipse' ? 'ellipse' : ''}`} style={{ left: screen.x - rect.left, top: screen.y - rect.top, width: draft.width * flow.getZoom(), height: draft.height * flow.getZoom() }} />}
    </div>}
  </div></Actions.Provider>;
}

export function createCanvasRenderer(container: HTMLElement, initialViewport: Viewport) {
  const root = createRoot(container);
  let instance: ReactFlowInstance<StudioNode, Edge> | undefined;
  let pendingFit = false;
  return {
    update(options: Options) { root.render(<ReactFlowProvider><CanvasFlow options={options} initialViewport={initialViewport} initialized={value => { instance = value; if (pendingFit) { pendingFit = false; requestAnimationFrame(() => void value.fitView({ padding: .16, maxZoom: 1.4 })); } }} /></ReactFlowProvider>); },
    fit() { if (instance) void instance.fitView({ padding: .16, maxZoom: 1.4 }); else pendingFit = true; },
    zoom(factor: number) { if (instance) void instance.zoomTo(Math.max(.08, Math.min(4, instance.getZoom() * factor))); },
  };
}
