export interface ResultsQueueBattery {
  id: string;
  order: number;
  state: string;
  firstStartedAt: string | null;
  registrations: Array<{ id: string; laneLabel?: string | null }>;
}

export interface ResultsQueueRegistration {
  id: string;
  laneLabel?: string | null;
}

export function compareResultsBatteries(a: ResultsQueueBattery, b: ResultsQueueBattery) {
  const rank = (battery: ResultsQueueBattery) =>
    battery.state === 'RUNNING' ? 0 : battery.firstStartedAt ? 1 : 2;
  const group = rank(a) - rank(b);
  if (group) return group;

  if (rank(a) < 2) {
    if (a.firstStartedAt && b.firstStartedAt && a.firstStartedAt !== b.firstStartedAt) {
      return a.firstStartedAt.localeCompare(b.firstStartedAt);
    }
    if (a.firstStartedAt && !b.firstStartedAt) return -1;
    if (!a.firstStartedAt && b.firstStartedAt) return 1;
  }
  return a.order - b.order;
}

export function groupResultsQueue<
  Battery extends ResultsQueueBattery,
  Registration extends ResultsQueueRegistration,
>(batteries: Battery[], registrations: Registration[]) {
  const registrationMap = new Map(registrations.map((registration) => [registration.id, registration]));
  const assignedIds = new Set<string>();
  const assigned = batteries.map((battery) => ({
    battery,
    registrations: battery.registrations.flatMap((entry) => {
      assignedIds.add(entry.id);
      const registration = registrationMap.get(entry.id);
      return registration
        ? [{ registration, lane: entry.laneLabel ?? registration.laneLabel ?? null }]
        : [];
    }),
  })).sort((a, b) => compareResultsBatteries(a.battery, b.battery));

  return {
    assigned,
    unassigned: registrations.filter((registration) => !assignedIds.has(registration.id)),
  };
}

export interface ResultForProgress {
  status: string;
  points: number | null;
  tieRulePending?: boolean;
}

export function summarizeRegistrationResults(
  results: Array<ResultForProgress | undefined>,
  assignedToEventBattery = true,
) {
  const present = results.filter((result): result is ResultForProgress => Boolean(result));
  if (!present.length) return 'Sem lançamento';
  if (!assignedToEventBattery) return 'Vínculo pendente';
  if (present.some((result) => result.status === 'PROVISIONAL' || result.status === 'DNS' || result.status === 'DNF')) return 'Parcial';
  if (present.length < results.length) return 'Parcial';
  if (present.some((result) => result.tieRulePending || result.points === null)) return 'Confirmado · pontuação pendente';
  return 'Confirmado';
}

export interface ResultMetric {
  metricType: string;
  unit: string | null;
}

export function formatEventResultValue(value: number | null, proof: ResultMetric) {
  if (value === null) return '—';
  if (proof.metricType === 'TIME') {
    const hundredths = Math.max(0, Math.round(value * 100));
    return `${String(Math.floor(hundredths / 6000)).padStart(2, '0')}:${String(Math.floor(hundredths / 100) % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
  }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)}${proof.unit ? ` ${proof.unit}` : ''}`;
}
