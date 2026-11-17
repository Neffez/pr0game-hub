import { describe, expect, it } from 'vitest';
import { prodDraftOf, prodDraftValid, prodOf } from '../src/buildOrderProd';

describe('production steps of the build order', () => {
  it('starts a new step from the synced factors, rounded to 10 %', () => {
    expect(prodDraftOf(undefined, { 1: 0.84, 2: 1, 3: 0 })).toEqual({ percent: { 1: 80, 2: 100, 3: 0 }, awaitBuilding: true });
    expect(prodDraftOf(undefined, null)).toEqual({ percent: { 1: 100, 2: 100, 3: 100 }, awaitBuilding: true });
  });

  it('stores the percent as factors and keeps the other settings of an imported step', () => {
    const imported = { factors: { 1: 0.55, 2: 1, 3: 1 }, awaitBuilding: false, awaitResearch: true, awaitShipyard: true, wait: 600 };
    const d = prodDraftOf(imported);
    expect(d.percent).toEqual({ 1: 55, 2: 100, 3: 100 });
    d.percent[1] = 20;
    expect(prodOf(d, imported)).toEqual({ factors: { 1: 0.2, 2: 1, 3: 1 }, awaitBuilding: false, awaitResearch: true, awaitShipyard: true, wait: 600 });
    expect(prodOf({ percent: { 1: 0, 2: 50, 3: 100 }, awaitBuilding: true })).toEqual({ factors: { 1: 0, 2: 0.5, 3: 1 }, awaitBuilding: true, awaitResearch: false, awaitShipyard: false, wait: 0 });
  });

  it('accepts 0 … 100 % only', () => {
    expect(prodDraftValid({ percent: { 1: 0, 2: 100, 3: 50 }, awaitBuilding: false })).toBe(true);
    expect(prodDraftValid({ percent: { 1: 110, 2: 100, 3: 50 }, awaitBuilding: false })).toBe(false);
  });
});
