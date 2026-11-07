/**
 * @file The sleep between polls (ECS-REQ-019), clamped to the range setTimeout accepts.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { utilities } from '../src/utilities.ts';

const TEST_OPTIONS = { timeout: 1000 };

/**
 * Tells whether a promise has already settled, without waiting for it.
 * @param promise - The promise to inspect.
 * @returns Whether the promise has resolved by now.
 */
async function isSettled(promise: Promise<void>): Promise<boolean> {
  const unsettled = Symbol('unsettled');
  const result = await Promise.race([promise, Promise.resolve(unsettled)]);
  return result !== unsettled;
}

/**
 * Switches to fake timers for the rest of the test.
 */
function useFakeTimers(): void {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

describe('ECS-REQ-019: sleep', () => {
  it('resolves only after the specified milliseconds', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    useFakeTimers();
    const sleeping = utilities.sleep(1000);

    await vi.advanceTimersByTimeAsync(999);

    await expect(isSettled(sleeping)).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(isSettled(sleeping)).resolves.toBe(true);
  });

  it('clamps negative delays to zero', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    useFakeTimers();
    const sleeping = utilities.sleep(-100);

    await vi.advanceTimersByTimeAsync(0);

    await expect(isSettled(sleeping)).resolves.toBe(true);
  });

  it('clamps delays above the setTimeout limit', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    useFakeTimers();
    const sleeping = utilities.sleep(3_000_000_000);

    await vi.advanceTimersByTimeAsync(2_147_483_646);

    await expect(isSettled(sleeping)).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(isSettled(sleeping)).resolves.toBe(true);
  });
});
