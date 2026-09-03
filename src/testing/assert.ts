export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Assertion failed: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function assertTrue(actual: boolean, message?: string): void {
  if (!actual) {
    throw new Error(message ?? 'Assertion failed: expected condition to be true');
  }
}

export function assertFalse(actual: boolean, message?: string): void {
  if (actual) {
    throw new Error(message ?? 'Assertion failed: expected condition to be false');
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `Assertion failed: expected ${expectedJson}, got ${actualJson}`);
  }
}

/**
 * Assert that `fn` throws and return the error for further message checks.
 * This protects fail-closed contracts where silently ignoring a boundary
 * violation would leave the caller unaware that it bypassed a gate.
 */
export function assertThrows(fn: () => unknown, message?: string): Error {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error(message ?? 'Assertion failed: expected function to throw');
}

export function assertDefined<T>(actual: T | null | undefined, message?: string): T {
  if (actual == null) {
    throw new Error(message ?? 'Assertion failed: expected value to be defined');
  }
  return actual;
}
