import assert from 'node:assert/strict';
import test from 'node:test';
import { GetZero3PublicBoardResponse } from '../../../../lib/api-zod/src/generated/api.ts';
import {
  classifyPublicBoardPayload,
  isPublicBoardJsonParseError,
} from './public-board-response-state.ts';

const validNoEvent = {
  serverTime: '2026-11-06T12:00:00.000Z',
  results: [],
  proofs: [],
  registrations: [],
  leaderboards: [],
  podiums: [],
  activeHeats: [],
};

function inspect(payload: unknown) {
  const parsed = GetZero3PublicBoardResponse.safeParse(payload);
  return classifyPublicBoardPayload(payload, parsed.success);
}

test('accepts the complete API response for a legitimate no-event state', () => {
  const result = inspect(validNoEvent);
  assert.equal(result.kind, 'valid');
  if (result.kind === 'valid') assert.equal(result.board.event, undefined);
});

test('rejects incomplete board payloads instead of treating them as no event', () => {
  assert.deepEqual(inspect({}), { kind: 'invalid' });
  assert.deepEqual(
    inspect({ ...validNoEvent, proofs: undefined }),
    { kind: 'invalid' },
  );
});

test('rejects malformed response data', () => {
  assert.deepEqual(
    inspect({ ...validNoEvent, serverTime: 'not-a-date' }),
    { kind: 'invalid' },
  );
  assert.deepEqual(inspect(null), { kind: 'invalid' });
});

test('recognizes a JSON parse failure separately from HTTP and network failures', () => {
  const parseError = new Error('invalid JSON');
  parseError.name = 'ResponseParseError';
  assert.equal(isPublicBoardJsonParseError(parseError), true);
  assert.equal(isPublicBoardJsonParseError(new Error('fetch failed')), false);
});
