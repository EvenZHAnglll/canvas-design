import { applyOperation, type CanvasData, type Operation } from './canvas';

interface Pending { id: string; operation: Operation; baseVersion?: number }
export interface EditRequest { type: 'edit'; requestId: string; operation: Operation; baseVersion: number }

/** Serializes optimistic edits and keeps agent changes from rebasing queued writes. */
export class EditSession {
  version = -1;
  private data: CanvasData = { nodes: [], edges: [] };
  private queue: Pending[] = [];
  private barrier?: number;
  private confirmed: { operation: Operation; version: number }[] = [];

  receive(version: number, data: CanvasData): string | undefined {
    if (version < this.version) return;
    this.version = version; this.data = structuredClone(data);
    this.confirmed = this.confirmed.filter(item => item.version > version);
    if (this.barrier !== undefined && version > this.barrier && this.queue.length && this.queue[0].baseVersion === undefined) {
      this.queue = []; this.barrier = undefined;
      return 'The file changed; queued edits were cancelled to preserve the latest design.';
    }
  }

  enqueue(id: string, operation: Operation) {
    applyOperation(this.preview(), operation);
    this.queue.push({ id, operation });
  }

  preview(): CanvasData {
    let result = structuredClone(this.data);
    for (const item of this.confirmed) result = applyOperation(result, item.operation);
    for (const item of this.queue) {
      if (item.baseVersion !== undefined && this.version > item.baseVersion) continue;
      try { result = applyOperation(result, item.operation); } catch { /* The host rejects stale operations. */ }
    }
    return result;
  }

  next(): EditRequest | undefined {
    const first = this.queue[0];
    if (!first || first.baseVersion !== undefined || this.version < 0 || this.barrier !== undefined && this.version < this.barrier) return;
    first.baseVersion = this.version;
    return { type: 'edit', requestId: first.id, operation: first.operation, baseVersion: this.version };
  }

  acknowledge(id: string, result: { version?: number; error?: string }): string | undefined {
    if (this.queue[0]?.id !== id) return;
    if (result.error || result.version === undefined) {
      this.queue = []; this.barrier = undefined;
      return result.error ?? 'Invalid acknowledgement from the editor.';
    }
    const applied = this.queue.shift()!;
    this.barrier = result.version;
    if (this.version < result.version) this.confirmed.push({ operation: applied.operation, version: result.version });
    if (this.version > result.version && this.queue.length) {
      this.queue = []; this.barrier = undefined;
      return 'The file changed; queued edits were cancelled to preserve the latest design.';
    }
  }

  get needsState(): boolean { return this.barrier !== undefined && this.version < this.barrier; }
}
