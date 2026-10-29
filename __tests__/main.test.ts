import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.js';

vi.mock('../src/action.js', () => ({ run: vi.fn(() => Promise.resolve()) }));

describe('ECS-REQ-001: Action entrypoint', () => {
  it('invokes run() unconditionally on import', async () => {
    await import('../src/main.js');

    expect(run).toHaveBeenCalledTimes(1);
  });
});
