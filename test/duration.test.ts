/**
 * @file Duration parsing (ECS-REQ-012, ECS-REQ-015).
 */
import { describe, expect, it } from 'vitest';
import { utilities } from '../src/utilities.ts';

const TEST_OPTIONS = { timeout: 1000 };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365.25 * DAY;

describe('ECS-REQ-012, ECS-REQ-015: duration formats', () => {
  it.each([
    ['500', 500],
    ['1.25s', 1250],
    ['.5s', 500],
    ['.25s', 250],
    ['5s', 5 * SECOND],
    ['15s', 15 * SECOND],
    ['5 m', 5 * MINUTE],
    ['5   m', 5 * MINUTE],
    ['2H', 2 * HOUR]
  ])('parses %s', TEST_OPTIONS, (value, expected) => {
    expect.hasAssertions();

    expect(utilities.parseDuration(value)).toBe(expected);
  });

  it('trims surrounding whitespace', TEST_OPTIONS, () => {
    expect.hasAssertions();

    expect(utilities.parseDuration(' 15s ')).toBe(15 * SECOND);
  });

  it('accepts durations of exactly 100 characters', TEST_OPTIONS, () => {
    expect.hasAssertions();

    expect(utilities.parseDuration(`${'0'.repeat(98)}1s`)).toBe(SECOND);
  });
});

describe('ECS-REQ-012, ECS-REQ-015: units up to an hour', () => {
  it.each([
    ['milliseconds', 1],
    ['millisecond', 1],
    ['msecs', 1],
    ['msec', 1],
    ['ms', 1],
    ['seconds', SECOND],
    ['second', SECOND],
    ['secs', SECOND],
    ['sec', SECOND],
    ['s', SECOND],
    ['minutes', MINUTE],
    ['minute', MINUTE],
    ['mins', MINUTE],
    ['min', MINUTE],
    ['m', MINUTE],
    ['hours', HOUR],
    ['hrs', HOUR],
    ['hr', HOUR],
    ['h', HOUR]
  ])('accepts the unit %s', TEST_OPTIONS, (unit, multiplier) => {
    expect.hasAssertions();

    expect(utilities.parseDuration(`3${unit}`)).toBe(3 * multiplier);
  });
});

describe('ECS-REQ-012, ECS-REQ-015: units from a day', () => {
  it.each([
    ['days', DAY],
    ['day', DAY],
    ['d', DAY],
    ['weeks', WEEK],
    ['week', WEEK],
    ['w', WEEK]
  ])('accepts the unit %s', TEST_OPTIONS, (unit, multiplier) => {
    expect.hasAssertions();

    expect(utilities.parseDuration(`3${unit}`)).toBe(3 * multiplier);
  });

  it.each(['years', 'year', 'yrs', 'yr', 'y'])('accepts the unit %s', TEST_OPTIONS, unit => {
    expect.hasAssertions();

    expect(utilities.parseDuration(`0.001${unit}`)).toBe(0.001 * YEAR);
  });
});

describe('ECS-REQ-015: invalid durations', () => {
  it.each([
    ['invalid', 'invalid'],
    ['empty', ''],
    ['blank', ' '.repeat(3)],
    ['unit-only', 's'],
    ['unknown unit', '5x'],
    ['trailing garbage', '5s later'],
    ['leading garbage', 'in 5s'],
    ['longer than 100 characters', `${'0'.repeat(99)}1s`]
  ])('throws a uniform error on %s input', TEST_OPTIONS, (_description, value) => {
    expect.hasAssertions();

    expect(() => utilities.parseDuration(value)).toThrow(`Invalid duration format: ${value}`);
  });

  it.each([
    ['negative', '-5s'],
    ['zero', '0s']
  ])('rejects %s durations', TEST_OPTIONS, (_description, value) => {
    expect.hasAssertions();

    expect(() => utilities.parseDuration(value)).toThrow(`Duration must be positive: ${value}`);
  });

  it('clamps durations above the setTimeout limit (~24.8 days)', TEST_OPTIONS, () => {
    expect.hasAssertions();

    expect(utilities.parseDuration('30d')).toBe(2_147_483_647);
  });
});
