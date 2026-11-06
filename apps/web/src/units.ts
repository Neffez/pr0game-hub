import { shallowRef } from 'vue';
import { registerUnitNames } from '@pr0hub/core/tech';
import { DEFAULT_UNITS, setActiveUnits, unitCatalog, type UnitCatalog, type UnitOverrides } from '@pr0hub/core/units';
import { encodeUnitOverrides } from '@pr0hub/core/universe';

/**
 * Ships, defense and missiles of the open universe (its differences from the hub's defaults). Reactive for lists in
 * templates; the functions of the packages read the same catalog as their active one.
 */
export const units = shallowRef<UnitCatalog>(DEFAULT_UNITS);

/** Sets the open universe's units; true when they changed. */
export function applyUnits(overrides: UnitOverrides | null | undefined): boolean {
  const catalog = unitCatalog(overrides);
  if (catalog === units.value) return false;
  registerUnitNames(catalog);
  setActiveUnits(catalog);
  units.value = catalog;
  return true;
}

/** `uo` value of the tools' links: the open universe's unit overrides ('' without any; the catalog key is their JSON). */
export const unitsLinkValue = (): string => encodeUnitOverrides(JSON.parse(units.value.key));

/** Ships that can fly (with drives), in game order. */
export const fleetShips = (): number[] => Object.keys(units.value.drives).map(Number);
