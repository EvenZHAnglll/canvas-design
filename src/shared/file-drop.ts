const formats = ['ResourceURLs', 'application/vnd.code.uri-list', 'text/uri-list'];
interface FileTransfer {
  readonly types: readonly string[];
  getData(format: string): string;
}

/** ResourceURLs is the Explorer's file drag payload; URI lists cover other editors. */
export function hasFileDrop(transfer: FileTransfer): boolean {
  return formats.some((format) =>
    transfer.types.some((type) => type.toLowerCase() === format.toLowerCase()),
  );
}

export function droppedFileUris(transfer: FileTransfer): string[] {
  for (const format of formats) {
    const value = transfer.getData(format);
    if (!value) continue;
    let values: unknown;
    try {
      values =
        format === 'ResourceURLs'
          ? JSON.parse(value)
          : value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line && !line.startsWith('#'));
    } catch {
      continue;
    }
    if (!Array.isArray(values)) continue;
    const uris = values.filter((uri): uri is string => {
      if (typeof uri !== 'string') return false;
      try {
        return new URL(uri).protocol === 'file:';
      } catch {
        return false;
      }
    });
    if (uris.length) return [...new Set(uris)];
  }
  return [];
}
