import { coerceEnvName, dedupeImportedSecrets, getDuplicateSecretNames } from './index';

describe('coerceEnvName', () => {
  it.each<[string, unknown, string]>([
    ['a plain name', 'dev', 'dev'],
    ['an integer', 123, '123'],
    ['zero', 0, '0'],
    ['a negative number', -1, '-1'],
    ['a decimal', 1.5, '1.5']
  ])('reads %s as text', (_label, name, expected) => {
    expect(coerceEnvName(name)).toBe(expected);
  });

  it.each<[string, unknown]>([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['undefined', undefined],
    ['null', null],
    ['a boolean', true],
    ['an object', {}],
    ['an array', ['dev']],
    ['NaN', NaN],
    ['Infinity', Infinity]
  ])('has no usable name for %s', (_label, name) => {
    expect(coerceEnvName(name)).toBeNull();
  });
});

describe('getDuplicateSecretNames', () => {
  it('returns an empty set when there are no variables', () => {
    expect(getDuplicateSecretNames([]).size).toBe(0);
    expect(getDuplicateSecretNames(undefined).size).toBe(0);
  });

  it('returns an empty set when secret names are unique', () => {
    const vars = [
      { name: 'token', secret: true },
      { name: 'apiKey', secret: true }
    ];
    expect(getDuplicateSecretNames(vars).size).toBe(0);
  });

  it('flags a name carried by more than one secret', () => {
    const vars = [
      { name: 'token', secret: true },
      { name: 'token', secret: true }
    ];
    expect([...getDuplicateSecretNames(vars)]).toEqual(['token']);
  });

  it('flags a collision even when one of the two secrets is disabled', () => {
    const vars = [
      { name: 'token', secret: true, enabled: true },
      { name: 'token', secret: true, enabled: false }
    ];
    expect([...getDuplicateSecretNames(vars)]).toEqual(['token']);
  });

  it('ignores duplicate names on non-secret variables', () => {
    const vars = [
      { name: 'host', secret: false },
      { name: 'host', secret: false }
    ];
    expect(getDuplicateSecretNames(vars).size).toBe(0);
  });

  it('does not flag a plain variable and a secret that share a name', () => {
    const vars = [
      { name: 'token', secret: false },
      { name: 'token', secret: true }
    ];
    expect(getDuplicateSecretNames(vars).size).toBe(0);
  });

  it('compares trimmed names and ignores blank ones', () => {
    const vars = [
      { name: 'token', secret: true },
      { name: '  token  ', secret: true },
      { name: '   ', secret: true },
      { name: '', secret: true }
    ];
    expect([...getDuplicateSecretNames(vars)]).toEqual(['token']);
  });

  it('is case-sensitive', () => {
    const vars = [
      { name: 'token', secret: true },
      { name: 'TOKEN', secret: true }
    ];
    expect(getDuplicateSecretNames(vars).size).toBe(0);
  });
});

describe('dedupeImportedSecrets', () => {
  const makeVar = (uid: string, name: string, value: string, overrides: Record<string, unknown> = {}) => ({
    uid,
    name,
    value,
    type: 'text',
    enabled: true,
    secret: true,
    ...overrides
  });

  it('returns the list untouched when secret names are unique', () => {
    const variables = [makeVar('uid-1', 'token', ''), makeVar('uid-2', 'apiKey', '')];

    expect(dedupeImportedSecrets(variables)).toBe(variables);
  });

  it('collapses two blank-valued secrets sharing a name down to the first', () => {
    const variables = [makeVar('uid-1', 'token', ''), makeVar('uid-2', 'token', '')];

    expect(dedupeImportedSecrets(variables)).toEqual([variables[0]]);
  });

  it('collapses every namesake when more than two collide', () => {
    const variables = [makeVar('uid-1', 'token', ''), makeVar('uid-2', 'token', ''), makeVar('uid-3', 'token', '')];

    expect(dedupeImportedSecrets(variables)).toEqual([variables[0]]);
  });

  it('collapses each colliding name independently and keeps the rest in order', () => {
    const variables = [
      makeVar('uid-1', 'apiKey', 'plain', { secret: false }),
      makeVar('uid-2', 'name', ''),
      makeVar('uid-3', 'name', ''),
      makeVar('uid-4', 'abc', ''),
      makeVar('uid-5', 'abc', '')
    ];

    expect(dedupeImportedSecrets(variables)).toEqual([variables[0], variables[1], variables[3]]);
  });

  // A Postman export ships secret values inline, so the twin holding one carries the only value
  // that survives the collision.
  it('keeps the twin holding a value over an earlier blank one', () => {
    const variables = [makeVar('uid-1', 'token', ''), makeVar('uid-2', 'token', 'from-postman')];

    expect(dedupeImportedSecrets(variables)).toEqual([variables[1]]);
  });

  it('keeps the first of several twins holding values', () => {
    const variables = [makeVar('uid-1', 'token', 'first'), makeVar('uid-2', 'token', 'second')];

    expect(dedupeImportedSecrets(variables)).toEqual([variables[0]]);
  });

  it('leaves duplicate non-secret names alone', () => {
    const variables = [makeVar('uid-1', 'host', 'a', { secret: false }), makeVar('uid-2', 'host', 'b', { secret: false })];

    expect(dedupeImportedSecrets(variables)).toBe(variables);
  });

  it('leaves a plain variable sharing a secret name alone', () => {
    const variables = [makeVar('uid-1', 'token', 'plain', { secret: false }), makeVar('uid-2', 'token', '')];

    expect(dedupeImportedSecrets(variables)).toBe(variables);
  });

  // Nothing is stored yet at import time, so there is no live value hiding under the untrimmed key
  // and the padded namesake is safe to collapse.
  it('collapses a whitespace-padded namesake, keeping the survivor name verbatim', () => {
    const variables = [makeVar('uid-1', 'token', ''), makeVar('uid-2', '  token  ', '')];

    expect(dedupeImportedSecrets(variables)).toEqual([variables[0]]);
  });

  it('ignores blank secret names', () => {
    const variables = [makeVar('uid-1', '', ''), makeVar('uid-2', '   ', '')];

    expect(dedupeImportedSecrets(variables)).toBe(variables);
  });

  it('treats names differing only in case as distinct', () => {
    const variables = [makeVar('uid-1', 'token', ''), makeVar('uid-2', 'TOKEN', '')];

    expect(dedupeImportedSecrets(variables)).toBe(variables);
  });

  it('keeps a disabled twin when it is the one holding a value', () => {
    const variables = [makeVar('uid-1', 'token', ''), makeVar('uid-2', 'token', 'kept', { enabled: false })];

    expect(dedupeImportedSecrets(variables)).toEqual([variables[1]]);
  });
});
