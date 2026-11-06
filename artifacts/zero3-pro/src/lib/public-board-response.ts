import { GetZero3PublicBoardResponse } from '@workspace/api-zod';
import type { Zero3PublicBoard } from '@workspace/api-client-react';

export type PublicBoardPayloadResult =
  | { kind: 'valid'; board: Zero3PublicBoard }
  | { kind: 'invalid' };

export function inspectPublicBoardPayload(payload: unknown): PublicBoardPayloadResult {
  const parsed = GetZero3PublicBoardResponse.safeParse(payload);
  return parsed.success
    ? { kind: 'valid', board: payload as Zero3PublicBoard }
    : { kind: 'invalid' };
}

export function isPublicBoardJsonParseError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResponseParseError';
}
