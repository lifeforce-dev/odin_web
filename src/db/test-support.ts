import { expect } from 'vitest';

// Drizzle wraps driver failures in DrizzleQueryError; the constraint reason
// (UNIQUE, FOREIGN KEY) only appears on the wrapped error's cause chain.
// Anything that wants to react to a specific violation must look there.
export async function expectRejectsWithCause(
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error('expected the operation to reject, but it resolved');
    },
    (raised: unknown) => raised,
  );
  const messages: string[] = [];
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  expect(messages.join(' | ')).toMatch(pattern);
}
