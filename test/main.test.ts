/**
 * @file The entrypoint (ECS-REQ-001).
 */
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('../src/action.ts'), () => ({ run: vi.fn<() => Promise<void>>() }));

describe('ECS-REQ-001: the action entrypoint', () => {
  it('invokes run() unconditionally on import', { timeout: 5000 }, async () => {
    expect.hasAssertions();

    await import('../src/main.ts');

    expect(run).toHaveBeenCalledExactlyOnceWith();
  });
});
