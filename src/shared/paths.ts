import path from 'node:path';

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export function referenceCandidates(
  documentPath: string,
  reference: string,
  workspacePaths: string[],
): string[] {
  if (!reference || reference.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(reference)) return [];
  const directory = path.dirname(documentPath);
  const roots = [directory, ...workspacePaths];
  const candidates = path.isAbsolute(reference)
    ? [path.normalize(reference)]
    : [
        path.resolve(directory, reference),
        ...workspacePaths.map((root) => path.resolve(root, reference)),
      ];
  return [...new Set(candidates)].filter((candidate) =>
    roots.some((root) => isWithin(root, candidate)),
  );
}

export function canExpandCanvas(
  reference: string,
  ancestors: string[],
  depth: number,
): string | undefined {
  if (ancestors.includes(reference)) return 'Circular Canvas reference';
  if (depth >= 4) return 'Nested Canvas depth limit (4)';
  return undefined;
}
