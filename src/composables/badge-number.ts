// Formats a 1-based position as the two-digit, zero-padded string shown in
// a numbered badge (01, 02, ...). Shared by the workbench slot numbers, the
// rotation queue's order badge, and the queue's landing-gap badge.
export function badgeNumber(n: number): string {
  return String(n).padStart(2, '0');
}
