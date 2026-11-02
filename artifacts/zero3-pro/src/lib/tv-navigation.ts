export function tvHrefForEvent(eventId?: string | null): string {
  if (!eventId) return "/tv";
  return `/tv?${new URLSearchParams({ eventId }).toString()}`;
}
