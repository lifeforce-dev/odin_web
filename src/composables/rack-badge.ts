// The rack badge's two-digit grammar in one place: the workbench slot
// index, the queue order badge, and the queue's landing-gap badge all
// share it.
export function rackBadge(n: number): string {
  return String(n).padStart(2, '0');
}
