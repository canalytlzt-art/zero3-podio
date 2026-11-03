export function isSessionScopedZero3QueryKey(
  queryKey: readonly unknown[],
): boolean {
  return queryKey.some(
    (part) =>
      typeof part === "string" &&
      part.startsWith("/api/zero3/") &&
      part !== "/api/zero3/public-board",
  );
}
