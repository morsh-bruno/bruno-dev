export interface SecretNamedVariable {
  name?: string;
  secret?: boolean;
}

export interface ImportedEnvironmentVariable extends SecretNamedVariable {
  value?: unknown;
}

/**
 * Reads the name an imported environment file carries. Exports hand over strings, but a hand-edited
 * or foreign file may carry a number or nothing usable; a finite number is kept as text and
 * anything else yields `null` so callers can refuse the environment with one message.
 */
export const coerceEnvName = (name: unknown): string | null => {
  if (typeof name === 'string') {
    return name.trim() === '' ? null : name;
  }
  if (typeof name === 'number' && Number.isFinite(name)) {
    return String(name);
  }
  return null;
};

/**
 * Secret values are persisted in a name-keyed side store and re-attached on read by name, so two
 * secrets sharing a name collapse to one and the second loses its value. Names must therefore be
 * unique among secrets. Returns the set of names carried by more than one secret variable. Only
 * secret rows are counted, so callers need not filter by tab.
 */
export const getDuplicateSecretNames = (variables?: SecretNamedVariable[] | null): Set<string> => {
  const counts = new Map<string, number>();
  (variables || []).forEach((v) => {
    if (v.secret && v.name && v.name.trim() !== '') {
      const key = v.name.trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
};

/**
 * Strips the duplicate secrets out of an imported environment, so an import never lands the user
 * with a collision they did not author. Keeps whichever twin holds a value, since a Postman export
 * ships secret values inline.
 */
export const dedupeImportedSecrets = <T extends ImportedEnvironmentVariable>(variables: T[]): T[] => {
  const duplicates = getDuplicateSecretNames(variables);
  if (duplicates.size === 0) {
    return variables;
  }

  const survivors = new Map<string, T>();
  variables.forEach((v) => {
    const name = (v.name || '').trim();
    if (!v.secret || !duplicates.has(name)) return;
    const current = survivors.get(name);
    if (!current || (!current.value && v.value)) survivors.set(name, v);
  });

  return variables.filter((v) => {
    const name = (v.name || '').trim();
    return !v.secret || !duplicates.has(name) || survivors.get(name) === v;
  });
};
