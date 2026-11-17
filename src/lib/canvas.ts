// A canvas left to the garbage collector keeps its pixels until a collection. On an iPhone every canvas of a page draws on
// one memory limit, so a few full-size frames waiting there make the next canvas fail (audit V-169). A canvas that is
// done with gives its pixels back at once by being made empty.
export function letGo(canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
