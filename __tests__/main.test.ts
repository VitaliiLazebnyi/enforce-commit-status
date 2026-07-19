import { jest, describe, it, expect } from '@jest/globals';

const runMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/action.js', () => ({
  run: runMock
}));

describe('ECS-REQ-001: Action entrypoint', () => {
  it('invokes run() unconditionally on import', async () => {
    await import('../src/main.js');

    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
