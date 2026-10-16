import type { CanvasNode } from './canvas';

/** HTML is an editor subtype, never a fifth JSON Canvas node type. */
export function isHtmlNode(node: CanvasNode): boolean {
  return node.type === 'text' && node.canvasStudio?.type === 'html';
}

export const defaultHtml =
  '<div class="card">\n  <h2>HTML card</h2>\n  <p>Edit HTML and CSS in Details.</p>\n</div>';
export const defaultCss =
  '.card {\n  padding: 24px;\n  color: #27334b;\n  background: #f0edff;\n  border-radius: 12px;\n}\n.card h2 { margin: 0 0 12px; }\n.card p { margin: 0; line-height: 1.5; }';
