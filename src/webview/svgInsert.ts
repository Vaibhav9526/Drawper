import { convertToExcalidrawElements, CaptureUpdateAction } from '@excalidraw/excalidraw';
import { IconFile, importedSvgFile } from './icons';

export function viewCenter(api: any): [number, number] {
  const s = api.getAppState();
  return [s.width / 2 / s.zoom.value - s.scrollX, s.height / 2 / s.zoom.value - s.scrollY];
}

export function insertImage(api: any, file: IconFile, width = 64, height = 64) {
  api.addFiles([file]);
  const [cx, cy] = viewCenter(api);
  const k = 72 / Math.max(width, height);
  const [img] = convertToExcalidrawElements([{ type: 'image', fileId: file.id, x: cx - (width * k) / 2, y: cy - (height * k) / 2, width: width * k, height: height * k, status: 'saved' } as any], { regenerateIds: true });
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), img], appState: { selectedElementIds: { [img.id]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

export function insertSvgMarkup(api: any, name: string, markup: string): boolean {
  const imported = importedSvgFile(name, markup);
  if (!imported) return false;
  insertImage(api, imported.file, imported.width, imported.height);
  return true;
}

export function freeSpot(api: any, w = 240, h = 130): [number, number] {
  const [cx, cy] = viewCenter(api);
  const boxes = api.getSceneElements()
    .filter((e: any) => ['service', 'table'].includes(e.customData?.drawper))
    .map((e: any) => ({ x: e.x, y: e.y, w: e.width, h: e.height }));
  const hits = (x: number, y: number) => boxes.some((b: any) => x < b.x + b.w + 30 && x + w + 30 > b.x && y < b.y + b.h + 30 && y + h + 30 > b.y);
  const cells: [number, number][] = [];
  for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) cells.push([dx, dy]);
  cells.sort((p, q) => p[0] ** 2 + p[1] ** 2 - (q[0] ** 2 + q[1] ** 2) || p[1] - q[1] || p[0] - q[0]);
  for (const [dx, dy] of cells) {
    const x = cx - w / 2 + dx * (w + 50), y = cy - h / 2 + dy * (h + 50);
    if (!hits(x, y)) return [x, y];
  }
  return [cx - w / 2, cy - h / 2];
}
