/**
 * @file The resolution of annotated tags to their commit (ECS-REQ-020).
 */
import { describe, expect, it, vi } from 'vitest';
import { utilities } from '../src/utilities.ts';

/**
 * The response of the "get a tag" endpoint.
 */
type TagResponse = {
  readonly data: { readonly object: { readonly sha: string; readonly type: string } };
};

/**
 * The parameters of the "get a tag" endpoint.
 */
type GetTagParameters = { readonly owner: string; readonly repo: string; readonly tag_sha: string };

const TEST_OPTIONS = { timeout: 1000 };
const REFERENCE = { owner: 'o', repository: 'r', sha: 'tag-sha' };

/**
 * Builds a mocked "get a tag" endpoint and a client that uses it.
 * @returns The endpoint and the client.
 */
function makeClient(): {
  readonly client: Parameters<typeof utilities.resolveCommitSha>[0];
  readonly getTag: ReturnType<typeof vi.fn<(parameters: GetTagParameters) => Promise<TagResponse>>>;
} {
  const getTag = vi.fn<(parameters: GetTagParameters) => Promise<TagResponse>>();
  return { client: { rest: { git: { getTag } } }, getTag };
}

/**
 * Builds the response for a tag object.
 * @param sha - The SHA of the object the tag points to.
 * @param type - The type of that object.
 * @returns The response.
 */
function tagObject(sha: string, type: string): TagResponse {
  return { data: { object: { sha, type } } };
}

describe('ECS-REQ-020: tags that resolve to a commit', () => {
  it('resolves an annotated tag to its underlying commit SHA', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const { client, getTag } = makeClient();
    getTag.mockResolvedValue(tagObject('underlying-commit-sha', 'commit'));

    await expect(utilities.resolveCommitSha(client, REFERENCE)).resolves.toBe(
      'underlying-commit-sha'
    );
    expect(getTag).toHaveBeenCalledExactlyOnceWith({ owner: 'o', repo: 'r', tag_sha: 'tag-sha' });
  });

  it('peels nested annotated tags (tag -> tag -> commit)', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const { client, getTag } = makeClient();
    getTag
      .mockResolvedValueOnce(tagObject('inner-tag-sha', 'tag'))
      .mockResolvedValueOnce(tagObject('commit-sha', 'commit'));

    await expect(utilities.resolveCommitSha(client, REFERENCE)).resolves.toBe('commit-sha');
    expect(getTag).toHaveBeenCalledTimes(2);
    expect(getTag).toHaveBeenLastCalledWith({ owner: 'o', repo: 'r', tag_sha: 'inner-tag-sha' });
  });

  it(
    'proceeds with the current SHA once the git database API returns 404',
    TEST_OPTIONS,
    async () => {
      expect.hasAssertions();
      const { client, getTag } = makeClient();
      getTag
        .mockResolvedValueOnce(tagObject('inner-sha', 'tag'))
        .mockRejectedValue({ status: 404 });

      await expect(utilities.resolveCommitSha(client, REFERENCE)).resolves.toBe('inner-sha');
    }
  );
});

describe('ECS-REQ-020: the nesting depth', () => {
  it('peels up to 10 levels of nested tags', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const { client, getTag } = makeClient();
    getTag.mockResolvedValue(tagObject('another-tag-sha', 'tag'));
    for (const level of ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']) {
      getTag.mockResolvedValueOnce(tagObject(level, 'tag'));
    }
    getTag.mockResolvedValueOnce(tagObject('deep-commit', 'commit'));

    await expect(utilities.resolveCommitSha(client, REFERENCE)).resolves.toBe('deep-commit');
    expect(getTag).toHaveBeenCalledTimes(10);
  });

  it('fails fast on absurdly deep tag nesting', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const { client, getTag } = makeClient();
    getTag.mockResolvedValue(tagObject('another-tag-sha', 'tag'));

    await expect(utilities.resolveCommitSha(client, REFERENCE)).rejects.toThrow(
      'Annotated tag tag-sha exceeds the maximum nesting depth of 10.'
    );
    expect(getTag).toHaveBeenCalledTimes(10);
  });
});

describe('ECS-REQ-020: failures', () => {
  it('fails fast when a tag points at a non-commit object', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const { client, getTag } = makeClient();
    getTag.mockResolvedValue(tagObject('tree-sha', 'tree'));

    await expect(utilities.resolveCommitSha(client, REFERENCE)).rejects.toThrow(
      "Annotated tag tag-sha does not resolve to a commit (points to a 'tree' object)."
    );
  });

  it('rethrows non-404 API errors for the caller to classify', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const { client, getTag } = makeClient();
    getTag.mockRejectedValueOnce({ message: 'Internal Server Error', status: 500 });

    await expect(utilities.resolveCommitSha(client, REFERENCE)).rejects.toStrictEqual({
      message: 'Internal Server Error',
      status: 500
    });
  });
});
