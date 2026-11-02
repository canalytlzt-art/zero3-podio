export type ClerkSessionState = {
  isAuthenticated?: boolean;
  userId?: string | null;
  sessionId?: string | null;
};

export function hasSignedInUserSession(
  auth: ClerkSessionState | null | undefined,
): boolean {
  return (
    auth?.isAuthenticated === true &&
    Boolean(auth.userId) &&
    Boolean(auth.sessionId)
  );
}
