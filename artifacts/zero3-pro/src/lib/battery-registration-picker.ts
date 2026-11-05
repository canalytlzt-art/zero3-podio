import { normalizeAthleteSearch } from "./athlete-search.ts";

export type BatteryRegistrationFilter = "ALL" | "RX" | "SCALE";

export interface BatteryPickerRegistration {
  id: string;
  category: string;
  teamName?: string | null;
  athleteNames: string[];
  laneLabel?: string | null;
  confirmationStatus?: string;
}

export interface BatteryPickerBattery {
  id: string;
  order: number;
  name: string;
  registrations: readonly { id: string }[];
}

export function filterBatteryRegistrations(
  registrations: readonly BatteryPickerRegistration[],
  query: string,
  category: BatteryRegistrationFilter,
): BatteryPickerRegistration[] {
  const normalizedQuery = normalizeAthleteSearch(query);
  return registrations.filter((registration) => {
    const normalizedCategory = registration.category.trim().toUpperCase();
    const matchesCategory =
      category === "ALL" ||
      (category === "RX" && normalizedCategory === "RX") ||
      (category === "SCALE" && (normalizedCategory === "SC" || normalizedCategory === "SCALE"));
    if (!matchesCategory) return false;
    if (!normalizedQuery) return true;
    return [registration.teamName ?? "", ...registration.athleteNames]
      .some((name) => normalizeAthleteSearch(name).includes(normalizedQuery));
  });
}

export function toggleBatteryRegistration(
  selectedIds: readonly string[],
  registrationId: string,
  selected: boolean,
): string[] {
  const current = new Set(selectedIds);
  if (selected) current.add(registrationId);
  else current.delete(registrationId);
  return selectedIds.filter((id) => current.has(id))
    .concat(selected && !selectedIds.includes(registrationId) ? [registrationId] : []);
}

export function findRegistrationBattery(
  registrationId: string,
  batteries: readonly BatteryPickerBattery[],
  currentBatteryId?: string,
): BatteryPickerBattery | undefined {
  return batteries.find((battery) =>
    battery.id !== currentBatteryId &&
    battery.registrations.some((registration) => registration.id === registrationId));
}
