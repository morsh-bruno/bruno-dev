/**
 * The header store behind `req.headerList` and `bru.grpc.request.metadata`.
 *
 * The prepared request carries two views of its headers:
 *
 *   request.headerEntries  [{ key, value, disabled?: true }]  store, what the lists read and write
 *   request.headers        { name: value }                    projection of the enabled entries
 *
 * The object is what transport reads (axios, the gRPC client, interpolation, auth helpers) and what
 * `req.headers` hands to scripts, so it has to stay a plain object with one identity for the whole
 * run. The array is the source of truth for the list API's disabled rows; the order scripts see
 * comes from `orderedHeaderEntries`. These two helpers keep them in step:
 *
 *   reconcileHeaderEntries  object → entries, run before every list read. Picks up writes the list
 *                           cannot see: `req.headers.x = 'y'`, `req.setHeader()`, auth headers and
 *                           body defaults that prepare adds after building the entries, interpolation.
 *   projectHeaderEntries    entries → object, run after every list write.
 *
 * Disabled entries never have a counterpart in the object, so neither helper touches them.
 * Keys are compared exactly here; case-insensitivity is a property of the list API only.
 */

/**
 * Build both views from the `[{ name, value, enabled }]` rows a request is prepared from (after the
 * collection and folder headers are merged in). The one place the CLI and the app create the store.
 *
 * Rows without a name are skipped. A name enabled more than once gets one entry, at the position of
 * its first row with the value of its last: the same place and value the object gives it, so the
 * store starts with one enabled entry per key.
 * @param {Array<{ name: string, value: *, enabled: boolean }>} rows
 * @returns {{ headers: object, headerEntries: Array }}
 */
const buildHeaderEntries = (rows) => {
  const headers = {};
  const headerEntries = [];
  const enabledByKey = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!(row?.name?.length > 0)) continue;

    if (!row.enabled) {
      headerEntries.push({ key: row.name, value: row.value, disabled: true });
      continue;
    }

    headers[row.name] = row.value;
    const existing = enabledByKey.get(row.name);
    if (existing) {
      existing.value = row.value;
    } else {
      const entry = { key: row.name, value: row.value };
      enabledByKey.set(row.name, entry);
      headerEntries.push(entry);
    }
  }

  return { headers, headerEntries };
};

// defineProperty so a key like `__proto__` becomes an own entry instead of changing the prototype.
const setHeaderKey = (target, key, value) => {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
};

const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target, key);

/**
 * Bring `entries` in line with `headers`, in place.
 * @param {Array<{ key: string, value: *, disabled?: boolean }>} entries
 * @param {object} headers
 * @returns {Array} the same `entries` array
 */
const reconcileHeaderEntries = (entries, headers) => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.disabled) continue;
    if (!hasOwn(headers, entry.key)) {
      entries.splice(i, 1);
    } else if (headers[entry.key] !== entry.value) {
      entry.value = headers[entry.key];
    }
  }

  for (const key of Object.keys(headers)) {
    if (!entries.some((entry) => !entry.disabled && entry.key === key)) {
      entries.push({ key, value: headers[key] });
    }
  }

  return entries;
};

/**
 * Bring `headers` in line with the enabled `entries`, in place.
 * @param {Array<{ key: string, value: *, disabled?: boolean }>} entries
 * @param {object} headers
 * @returns {object} the same `headers` object
 */
const projectHeaderEntries = (entries, headers) => {
  const enabledKeys = new Set();

  for (const entry of entries) {
    if (entry.disabled) continue;
    enabledKeys.add(entry.key);
    if (!hasOwn(headers, entry.key) || headers[entry.key] !== entry.value) {
      setHeaderKey(headers, entry.key, entry.value);
    }
  }

  for (const key of Object.keys(headers)) {
    if (!enabledKeys.has(key)) {
      delete headers[key];
    }
  }

  return headers;
};

/**
 * The live store of a writable list. Seeds both views when the request was built without them, so
 * a request carrying only a `headers` object (older callers, unit tests) still works.
 * @param {object} request - The prepared request; `headers` and `headerEntries` are created on demand
 * @returns {Array} the request's reconciled `headerEntries`
 */
const liveHeaderEntries = (request) => {
  request.headers ??= {};
  request.headerEntries ??= [];

  return reconcileHeaderEntries(request.headerEntries, request.headers);
};

/**
 * Copies of the live entries in the order the lists hand them to scripts: disabled entries first,
 * then enabled entries in `headers` key order.
 * COMPAT: the order the list had before the array store, when it was built from the disabled
 * headers followed by `req.headers`.
 * @param {object} request - The prepared request
 * @returns {Array} copies, safe to hand out
 */
const orderedHeaderEntries = (request) => {
  const entries = liveHeaderEntries(request);
  const enabledByKey = new Map(entries.filter((entry) => !entry.disabled).map((entry) => [entry.key, entry]));
  return [
    ...entries.filter((entry) => entry.disabled),
    ...Object.keys(request.headers).map((key) => enabledByKey.get(key))
  ].map((entry) => ({ ...entry }));
};

/**
 * A static `[{ key, value }]` snapshot for the read-only lists (response headers, response metadata
 * and trailers). Accepts the `[{ name, value }]` display rows the response pane renders or a plain
 * `{ name: value }` map.
 * @param {Array|object} source
 * @returns {Array}
 */
const snapshotHeaderEntries = (source) => {
  if (Array.isArray(source)) {
    return source.map(({ name, value }) => ({ key: name, value }));
  }
  if (source && typeof source === 'object') {
    return Object.entries(source).map(([key, value]) => ({ key, value }));
  }
  return [];
};

/**
 * `{ key: value }` map of header entries, matching Postman's `PropertyList.toObject()` signature.
 * Disabled entries go in first so an enabled entry with the same key always wins the map,
 * whatever their relative order in the list.
 *
 * @param {Array} entries - `{ key, value, disabled? }` entries
 * @param {boolean} [excludeDisabled=false] - If true, skip disabled entries
 * @param {boolean} [caseSensitive=true] - If false, lowercase all keys
 * @param {boolean} [multiValue=false] - If true, only the first value of a duplicate key is kept
 * @param {boolean} [sanitizeKeys=false] - If true, skip entries with falsy keys
 * @returns {object}
 */
const headerEntriesToObject = (entries, excludeDisabled, caseSensitive, multiValue, sanitizeKeys) => {
  const result = {};
  const ordered = [...entries.filter((entry) => entry.disabled), ...entries.filter((entry) => !entry.disabled)];
  for (const entry of ordered) {
    if (excludeDisabled && entry.disabled) continue;
    const key = caseSensitive === false ? entry.key.toLowerCase() : entry.key;
    if (sanitizeKeys && !key) continue;
    if (multiValue) {
      if (!(key in result)) {
        result[key] = entry.value;
      }
    } else {
      result[key] = entry.value;
    }
  }
  return result;
};

module.exports = {
  buildHeaderEntries,
  headerEntriesToObject,
  setHeaderKey,
  reconcileHeaderEntries,
  projectHeaderEntries,
  liveHeaderEntries,
  orderedHeaderEntries,
  snapshotHeaderEntries
};
