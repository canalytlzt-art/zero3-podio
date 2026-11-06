import type { Zero3PublicBoard } from '@workspace/api-client-react';

export type PublicBoardPayloadResult =
  | { kind: 'valid'; board: Zero3PublicBoard }
  | { kind: 'invalid' };

export function classifyPublicBoardPayload(
  payload: unknown,
  isValid: boolean,
): PublicBoardPayloadResult {
  return isValid
    ? { kind: 'valid', board: payload as Zero3PublicBoard }
    : { kind: 'invalid' };
}

export function isPublicBoardJsonParseError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResponseParseError';
}
