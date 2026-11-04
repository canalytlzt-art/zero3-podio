import assert from 'node:assert/strict';
import test from 'node:test';
import {
  batteryIssueActionLabel,
  batteryIssueHref,
  batteryReadinessCount,
  getBatteryReadinessIssues,
} from './event-battery-readiness.ts';

function fixture() {
  const registrations = Array.from({ length: 5 }, (_, index) => ({
    id: `registration-${index + 1}`,
    batteryId: 'battery-1',
    category: index < 3 ? 'RX' : 'SC',
    teamName: `Equipe ${index + 1}`,
    athleteNames: [`Atleta ${index + 1}`],
    laneLabel: `P${String(index + 1).padStart(2, '0')}`,
  }));
  const proofs = Array.from({ length: 4 }, (_, index) => ({
    id: `proof-${index + 1}`,
    eventId: 'event-1',
    order: index + 1,
    name: `Prova ${index + 1}`,
    metricType: 'TIME' as const,
    unit: 's',
    direction: 'LOWER' as const,
    configured: true,
  }));
  const results = registrations.flatMap((registration) =>
    proofs.map((proof) => ({
      id: `result-${registration.id}-${proof.id}`,
      eventId: 'event-1',
      registrationId: registration.id,
      proofId: proof.id,
      batteryId: 'battery-1',
      heatId: null,
      category: registration.category,
      laneLabel: registration.laneLabel,
      elapsedMs: null,
      rawValue: 60,
      placement: null,
      points: null,
      tieRulePending: false,
      syncErrorMs: null,
      status: 'VALIDATED' as const,
      capturedAt: '2026-11-04T12:00:00.000Z',
      revision: 1,
      names: registration.athleteNames,
      teamName: registration.teamName,
      heatName: null,
    })),
  );
  return {
    id: 'battery-1',
    eventId: 'event-1',
    order: 1,
    name: 'Bateria 01',
    state: 'FINISHED' as const,
    elapsedMs: 0,
    eventElapsedMs: 0,
    eventLimitMs: 7200000,
    preparationEndsAt: null,
    preparationRemainingMs: 0,
    preparationSeconds: 10,
    startedAt: null,
    preparationStartedAt: null,
    firstStartedAt: null,
    stoppedAt: null,
    registrations,
    proofs,
    results,
    proofLeaderboards: [],
    categories: ['RX', 'SC'],
    pendingResultCount: 0,
    reviewedResultCount: 20,
    expectedResultCount: 20,
    finalizationCurrent: false,
    finalized: false,
    finalizationFingerprint: 'fingerprint',
    finalizationVersion: null,
    finalizedAt: null,
    timerVersion: 0,
    updatedAt: '2026-11-04T12:00:00.000Z',
  };
}

test('five teams across four proofs reports the exact missing team and proof', () => {
  const battery = fixture();
  battery.results = battery.results.filter(
    (result) => !(result.registrationId === 'registration-5' && result.proofId === 'proof-3'),
  );
  battery.reviewedResultCount = 19;
  battery.pendingResultCount = 1;

  const issues = getBatteryReadinessIssues(battery);
  assert.equal(batteryReadinessCount(battery, issues), 19);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.teamName, 'Equipe 5');
  assert.equal(issues[0]?.proofName, 'Prova 3');
  assert.equal(issues[0]?.kind, 'MISSING');

  const href = batteryIssueHref('event-1', 'battery-1', issues[0]!);
  const url = new URL(href, 'https://example.test');
  assert.equal(url.searchParams.get('eventId'), 'event-1');
  assert.equal(url.searchParams.get('batteryId'), 'battery-1');
  assert.equal(url.searchParams.get('registrationId'), 'registration-5');
  assert.equal(url.searchParams.get('proofId'), 'proof-3');
  assert.equal(url.hash, '#op-value');
  assert.equal(batteryIssueActionLabel(issues[0]!.kind), 'Lançar resultado');
});

test('provisional, invalid, DNS/DNF and unconfigured proofs stay blocked with distinct actions', () => {
  const battery = fixture();
  const setStatus = (registrationId: string, proofId: string, status: string, rawValue: number | null) => {
    const result = battery.results.find((item) => item.registrationId === registrationId && item.proofId === proofId);
    assert.ok(result);
    Object.assign(result, { status, rawValue });
  };
  setStatus('registration-1', 'proof-1', 'PROVISIONAL', 60);
  setStatus('registration-2', 'proof-2', 'VALIDATED', null);
  setStatus('registration-3', 'proof-3', 'DNF', null);
  battery.proofs[3]!.configured = false;

  const issues = getBatteryReadinessIssues(battery);
  assert.deepEqual(issues.map((item) => item.kind), ['CONFIGURATION', 'REVIEW', 'INVALID', 'EXCEPTION']);
  assert.equal(batteryReadinessCount(battery), 12);

  const reviewIssue = issues.find((item) => item.kind === 'REVIEW')!;
  const reviewUrl = new URL(batteryIssueHref('event-1', 'battery-1', reviewIssue), 'https://example.test');
  assert.equal(reviewUrl.searchParams.get('resultId'), 'result-registration-1-proof-1');
  assert.equal(reviewUrl.hash, '#review-value-result-registration-1-proof-1');
  assert.equal(batteryIssueActionLabel(reviewIssue.kind), 'Revisar resultado');

  const configIssue = issues.find((item) => item.kind === 'CONFIGURATION')!;
  const configUrl = new URL(batteryIssueHref('event-1', 'battery-1', configIssue), 'https://example.test');
  assert.equal(configUrl.searchParams.get('focus'), 'proof');
  assert.equal(configUrl.hash, '#proof-proof-4');
  assert.equal(batteryIssueActionLabel(configIssue.kind), 'Configurar prova');
});
