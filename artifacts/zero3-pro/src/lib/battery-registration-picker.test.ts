import assert from "node:assert/strict";
import test from "node:test";
import {
  filterBatteryRegistrations,
  findRegistrationBattery,
  toggleBatteryRegistration,
  type BatteryPickerBattery,
  type BatteryPickerRegistration,
} from "./battery-registration-picker.ts";

const registrations: BatteryPickerRegistration[] = [
  {
    id: "rx-1",
    category: "RX",
    teamName: "Dupla Águia",
    athleteNames: ["João Lima", "Ana Souza"],
    laneLabel: "P01",
  },
  {
    id: "scale-1",
    category: "SC",
    teamName: "Fênix",
    athleteNames: ["Lia Costa", "Beto Reis"],
    laneLabel: null,
  },
  {
    id: "rx-2",
    category: "RX",
    teamName: null,
    athleteNames: ["Maya Fernandes", "Davi Moreira"],
    laneLabel: "P03",
  },
];

test("search matches partial team and athlete names without accents", () => {
  assert.deepEqual(
    filterBatteryRegistrations(registrations, "agui", "ALL").map((item) => item.id),
    ["rx-1"],
  );
  assert.deepEqual(
    filterBatteryRegistrations(registrations, "joao lim", "RX").map((item) => item.id),
    ["rx-1"],
  );
  assert.deepEqual(
    filterBatteryRegistrations(registrations, "lia", "SCALE").map((item) => item.id),
    ["scale-1"],
  );
});

test("filters show RX and Scale separately while Todas includes both", () => {
  assert.deepEqual(filterBatteryRegistrations(registrations, "", "RX").map((item) => item.id), ["rx-1", "rx-2"]);
  assert.deepEqual(filterBatteryRegistrations(registrations, "", "SCALE").map((item) => item.id), ["scale-1"]);
  assert.equal(filterBatteryRegistrations(registrations, "", "ALL").length, 3);
});

test("selection remains additive across category filters and can be removed", () => {
  const rxSelection = toggleBatteryRegistration([], "rx-1", true);
  const mixedSelection = toggleBatteryRegistration(rxSelection, "scale-1", true);
  assert.deepEqual(mixedSelection, ["rx-1", "scale-1"]);
  assert.deepEqual(toggleBatteryRegistration(mixedSelection, "rx-1", false), ["scale-1"]);
});

test("assigned registrations identify the other battery and exclude the current one", () => {
  const batteries: BatteryPickerBattery[] = [
    { id: "battery-1", order: 1, name: "Principal", registrations: [{ id: "rx-1" }] },
    { id: "battery-2", order: 2, name: "Outra", registrations: [{ id: "scale-1" }] },
  ];
  assert.equal(findRegistrationBattery("rx-1", batteries)?.name, "Principal");
  assert.equal(findRegistrationBattery("rx-1", batteries, "battery-1"), undefined);
});
