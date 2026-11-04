import type { Zero3EventBattery } from '@workspace/api-client-react';

export type BatteryReadinessIssueKind =
  | 'MISSING'
  | 'REVIEW'
  | 'EXCEPTION'
  | 'INVALID'
  | 'CONFIGURATION';

export interface BatteryReadinessIssue {
  kind: BatteryReadinessIssueKind;
  registrationId: string;
  proofId: string;
  resultId: string | null;
  laneLabel: string | null;
  teamName: string;
  category: string;
  proofOrder: number;
  proofName: string;
}

type BatteryReadinessInput = Pick<
  Zero3EventBattery,
  'registrations' | 'proofs' | 'results' | 'expectedResultCount'
>;

export function getBatteryReadinessIssues(
  battery: BatteryReadinessInput,
): BatteryReadinessIssue[] {
  const issues: BatteryReadinessIssue[] = [];
  const proofs = [...battery.proofs].sort((a, b) => a.order - b.order);

  for (const proof of proofs.filter((item) => !item.configured)) {
    issues.push({
      kind: 'CONFIGURATION',
      registrationId: '',
      proofId: proof.id,
      resultId: null,
      laneLabel: null,
      teamName: 'Todas as equipes',
      category: '—',
      proofOrder: proof.order,
      proofName: proof.name || `Prova ${proof.order}`,
    });
  }

  for (const registration of battery.registrations) {
    for (const proof of proofs) {
      if (!proof.configured) continue;
      const result = battery.results.find(
        (item) => item.registrationId === registration.id && item.proofId === proof.id,
      );
      let kind: BatteryReadinessIssueKind | null = null;

      if (!result) kind = 'MISSING';
      else if (result.status === 'DNS' || result.status === 'DNF') kind = 'EXCEPTION';
      else if (result.status === 'PROVISIONAL') kind = 'REVIEW';
      else if (
        result.status !== 'VALIDATED' ||
        result.rawValue === null ||
        !Number.isFinite(Number(result.rawValue)) ||
        Number(result.rawValue) < 0
      ) kind = 'INVALID';

      if (!kind) continue;
      issues.push({
        kind,
        registrationId: registration.id,
        proofId: proof.id,
        resultId: result?.id ?? null,
        laneLabel: registration.laneLabel,
        teamName: registration.teamName || registration.athleteNames.join(' / ') || registration.id,
        category: registration.category,
        proofOrder: proof.order,
        proofName: proof.name || `Prova ${proof.order}`,
      });
    }
  }

  return issues;
}

export function batteryReadinessCount(
  battery: BatteryReadinessInput,
) {
  const ready = battery.registrations.reduce((count, registration) =>
    count + battery.proofs.filter((proof) => {
      if (!proof.configured) return false;
      const result = battery.results.find(
        (item) => item.registrationId === registration.id && item.proofId === proof.id,
      );
      return Boolean(result&&result.status==='VALIDATED'&&result.rawValue!==null&&
        Number.isFinite(Number(result.rawValue))&&Number(result.rawValue)>=0);
    }).length, 0);
  return Math.min(battery.expectedResultCount, ready);
}

export function batteryIssueLabel(kind: BatteryReadinessIssueKind) {
  return ({
    MISSING: 'Faltando resultado',
    REVIEW: 'Aguardando revisão',
    EXCEPTION: 'Regra de exceção pendente',
    INVALID: 'Resultado inválido',
    CONFIGURATION: 'Prova sem configuração',
  } satisfies Record<BatteryReadinessIssueKind, string>)[kind];
}

export function batteryIssueActionLabel(kind: BatteryReadinessIssueKind) {
  if (kind === 'MISSING') return 'Lançar resultado';
  if (kind === 'CONFIGURATION') return 'Configurar prova';
  return 'Revisar resultado';
}

export function batteryIssueHref(
  eventId: string,
  batteryId: string,
  issue: BatteryReadinessIssue,
) {
  const query = new URLSearchParams({ eventId, batteryId, proofId: issue.proofId });
  if (issue.kind !== 'CONFIGURATION') query.set('registrationId', issue.registrationId);
  if (issue.resultId) query.set('resultId', issue.resultId);

  const hash = issue.kind === 'CONFIGURATION'
    ? `#proof-${encodeURIComponent(issue.proofId)}`
    : issue.resultId
      ? `#review-value-${encodeURIComponent(issue.resultId)}`
      : '#op-value';
  return `/operacao?${query.toString()}${issue.kind === 'CONFIGURATION' ? '&focus=proof' : ''}${hash}`;
}

export function eventBatteryHref(eventId: string, batteryId: string) {
  return `/operacao?${new URLSearchParams({ eventId, batteryId }).toString()}#operation-battery-card`;
}
