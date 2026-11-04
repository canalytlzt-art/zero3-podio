export type LiveBoardView = "battery" | "overall";

export function liveBoardHrefForEvent(
  eventId?: string | null,
  view?: LiveBoardView,
): string {
  const params = new URLSearchParams();
  if (eventId) params.set("eventId", eventId);
  if (view) params.set("view", view);
  const query = params.toString();
  return query ? `/placar-ao-vivo?${query}` : "/placar-ao-vivo";
}

export function liveBoardHrefForBattery(
  eventId: string | null | undefined,
  proofId: string,
  batteryOrder: number,
): string {
  const params = new URLSearchParams({
    proofId,
    batteryOrder: String(batteryOrder),
    view: "battery",
  });
  if (eventId) params.set("eventId", eventId);
  return `/placar-ao-vivo?${params.toString()}`;
}
