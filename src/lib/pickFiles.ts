// Kept apart from the importer (and its media engine) so the home screen imports it up front: WebKit opens a file
// picker only inside the tap itself, and `await import()` before it can lose the tap (a home card's first tap did
// nothing in the iOS Simulator until the importer was loaded, docs/12).
/** Opens the system file picker. Must be called from a user gesture. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    // Attached to the document: iOS Safari does not reliably fire `change` on detached file inputs.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(input);
    const done = (files: File[]) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    input.click();
  });
}
