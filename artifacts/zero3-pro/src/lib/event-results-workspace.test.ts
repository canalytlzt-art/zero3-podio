import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatEventResultValue,
  groupResultsQueue,
  summarizeRegistrationResults,
} from './event-results-workspace.ts';

test('groups assigned registrations by actual battery and orders running batteries by first start', () => {
  const duo = {
    id: 'registration-duo',
    laneLabel: '03',
    athleteNames: ['Lia Monteiro', 'Caio Lima'],
  };
  const other = { id: 'registration-other', laneLabel: '01', athleteNames: ['Bruna Alves', 'Andre Costa'] };
  const paused = { id: 'registration-paused', laneLabel: '02', athleteNames: ['Marina Rocha', 'Leo Nunes'] };
  const waiting = { id: 'registration-waiting', laneLabel: '04', athleteNames: ['Taina Lopes', 'Rafa Dias'] };
  const unassigned = { id: 'registration-unassigned', laneLabel: null, athleteNames: ['Nina Reis', 'Joao Melo'] };

  const grouped = groupResultsQueue(
    [
      {
        id: 'battery-01',
        order: 1,
        state: 'RUNNING',
        firstStartedAt: '2026-11-05T10:02:00.000Z',
        registrations: [{ id: duo.id, laneLabel: duo.laneLabel }],
      },
      {
        id: 'battery-02',
        order: 2,
        state: 'RUNNING',
        firstStartedAt: '2026-11-05T10:01:00.000Z',
        registrations: [{ id: other.id, laneLabel: other.laneLabel }],
      },
      {
        id: 'battery-03',
        order: 3,
        state: 'PAUSED',
        firstStartedAt: '2026-11-05T09:50:00.000Z',
        registrations: [{ id: paused.id, laneLabel: paused.laneLabel }],
      },
      {
        id: 'battery-04',
        order: 4,
        state: 'IDLE',
        firstStartedAt: null,
        registrations: [{ id: waiting.id, laneLabel: waiting.laneLabel }],
      },
    ],
    [duo, other, paused, waiting, unassigned],
  );

  assert.deepEqual(grouped.assigned.map(({ battery }) => battery.id), [
    'battery-02',
    'battery-01',
    'battery-03',
    'battery-04',
  ]);
  assert.equal(grouped.assigned[1]?.registrations[0]?.registration.athleteNames.length, 2);
  assert.deepEqual(grouped.unassigned.map(({ id }) => id), ['registration-unassigned']);
});

test('keeps proof status explicit and formats different result metrics', () => {
  assert.equal(summarizeRegistrationResults([undefined, undefined]), 'Sem lançamento');
  assert.equal(summarizeRegistrationResults([{ status: 'PROVISIONAL', points: null }, undefined]), 'Parcial');
  assert.equal(summarizeRegistrationResults([
    { status: 'VALIDATED', points: null },
    { status: 'VALIDATED', points: 2 },
  ]), 'Confirmado · pontuação pendente');
  assert.equal(summarizeRegistrationResults([
    { status: 'VALIDATED', points: 1 },
    { status: 'VALIDATED', points: 2 },
  ]), 'Confirmado');
  assert.equal(summarizeRegistrationResults([{ status: 'VALIDATED', points: 1 }], false), 'Vínculo pendente');
  assert.equal(formatEventResultValue(65.2, { metricType: 'TIME', unit: 's' }), '01:05.20');
  assert.equal(formatEventResultValue(85.5, { metricType: 'LOAD', unit: 'kg' }), '85,5 kg');
});
