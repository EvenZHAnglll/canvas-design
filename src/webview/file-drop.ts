import { droppedFileUris, hasFileDrop } from '../shared/file-drop';

interface Options {
  enabled(): boolean;
  drop(uris: string[], clientX: number, clientY: number): void;
  notice(message: string): void;
}

/** Claim file drops before VS Code's outer Webview handler opens the resource. */
export function enableFileDrop(stage: HTMLElement, options: Options): void {
  const clear = () => stage.classList.remove('file-drop-active');
  const accepts = (event: DragEvent) =>
    event.dataTransfer &&
    hasFileDrop(event.dataTransfer) &&
    !(
      event.target instanceof Element &&
      event.target.closest(
        '.toolbar, .statusbar, .sidebar-button, input, textarea, [contenteditable="true"]',
      )
    );
  for (const name of ['dragenter', 'dragover'] as const)
    stage.addEventListener(name, (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const enabled = options.enabled();
      event.dataTransfer!.dropEffect = enabled ? 'copy' : 'none';
      stage.classList.toggle('file-drop-active', enabled);
    });
  stage.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !stage.contains(event.relatedTarget)) clear();
  });
  window.addEventListener('dragend', clear);
  window.addEventListener('blur', clear);
  stage.addEventListener('drop', (event) => {
    clear();
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!options.enabled()) {
      options.notice('Finish the current edit and open a valid Canvas before adding files.');
      return;
    }
    const uris = droppedFileUris(event.dataTransfer!);
    if (!uris.length) {
      options.notice('Drag local files from Explorer to add references.');
      return;
    }
    options.drop(uris, event.clientX, event.clientY);
  });
}
