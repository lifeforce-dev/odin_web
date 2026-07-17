// One-shot cross-screen handoff for the rolled-back notice. Module-level
// state, not a route query flag: a query flag would survive a reload and
// lie about a rollback that never happened.
let armed = false;

export function armRollbackNotice(): void {
  armed = true;
}

// Always clears, armed or not: a second read (a re-render, a second
// mount) must never re-announce the same rollback.
export function consumeRollbackNotice(): boolean {
  const wasArmed = armed;
  armed = false;
  return wasArmed;
}

export function resetRollbackNotice(): void {
  armed = false;
}
