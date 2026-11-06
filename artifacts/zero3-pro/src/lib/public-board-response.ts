import { GetZero3PublicBoardResponse } from '@workspace/api-zod';
import { classifyPublicBoardPayload } from './public-board-response-state';
import type { PublicBoardPayloadResult } from './public-board-response-state';
export { isPublicBoardJsonParseError } from './public-board-response-state';

export function inspectPublicBoardPayload(payload: unknown): PublicBoardPayloadResult {
  const parsed = GetZero3PublicBoardResponse.safeParse(payload);
  return classifyPublicBoardPayload(payload, parsed.success);
}
