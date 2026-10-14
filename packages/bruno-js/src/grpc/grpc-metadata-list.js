const ReadOnlyPropertyList = require('../readonly-property-list');
const {
  headerEntriesToObject,
  liveHeaderEntries,
  orderedHeaderEntries,
  projectHeaderEntries,
  snapshotHeaderEntries
} = require('../utils/header-entries');

// Keep quickjs shim up to date on any updates to this class
class GrpcMetadataList extends ReadOnlyPropertyList {
  #request;
  #writable;

  /**
   * @param {object|Array} source - The prepared gRPC request (its `headers` and `headerEntries`
   *   are the store, read live), or the `[{ name, value }]` rows of a response to snapshot.
   * @param {object} [options]
   * @param {boolean} [options.writable=false] - When false, write methods throw. A snapshot is
   *   never writable.
   */
  constructor(source, { writable = false } = {}) {
    const snapshot = !source || Array.isArray(source);
    super({
      keyProperty: 'key',
      valueProperty: 'value',
      caseInsensitiveKeys: true,
      ...(snapshot
        ? { items: snapshotHeaderEntries(source) }
        : { dataSource: () => orderedHeaderEntries(source) })
    });
    this.#request = snapshot ? null : source;
    this.#writable = writable && !snapshot;
  }

  #assertWritable(method) {
    if (!this.#writable) {
      throw new Error(
        `metadata.${method}() is not available once the call has been sent — change metadata in the beforeCallStart hook`
      );
    }
  }

  // ── Transform override ───────────────────────────────────────────────

  /** `key: value` per line — how metadata travels as HTTP/2 headers. */
  toString() {
    return this.all()
      .filter((entry) => !entry.disabled)
      .map((entry) => `${entry.key}: ${entry.value}`)
      .join('\n');
  }

  // ── Write methods (edit the entries, then project into the headers map) ──

  /**
   * Insert a key, or update it in place when it already exists under any casing. The key ends
   * up enabled.
   *
   * @param {string} key
   * @param {*} value
   */
  upsert(key, value) {
    this.#assertWritable('upsert');

    if (typeof key !== 'string' || !key.length) {
      return;
    }

    this.#write({ key, value, disabled: false });
  }

  /**
   * Upsert an entry from the `{ key, value, disabled? }` shape `all()` returns, so an entry read
   * from one list can be handed straight to another.
   *
   * @param {object} item
   */
  add(item) {
    this.#assertWritable('add');

    if (!item || typeof item !== 'object' || typeof item.key !== 'string' || !item.key.length) {
      return;
    }

    this.#write({ key: item.key, value: item.value, disabled: item.disabled === true });
  }

  /**
   * Remove the entry with the given key, enabled or disabled.
   * @param {string} key
   */
  remove(key) {
    this.#assertWritable('remove');

    const entries = liveHeaderEntries(this.#request);

    for (let i = entries.length - 1; i >= 0; i--) {
      if (this._keyMatches(entries[i].key, key)) {
        entries.splice(i, 1);
      }
    }

    projectHeaderEntries(entries, this.#request.headers);
  }

  /** Remove every entry, enabled and disabled. */
  clear() {
    this.#assertWritable('clear');

    const entries = liveHeaderEntries(this.#request);

    // Emptied in place rather than reassigned: the request owns the array.
    entries.length = 0;

    projectHeaderEntries(entries, this.#request.headers);
  }

  /**
   * Convert to a plain object. Matches Postman's PropertyList.toObject() signature; an enabled
   * entry always wins over a disabled one with the same key.
   * @param {boolean} [excludeDisabled=true] - If true, skip disabled entries
   * @param {boolean} [caseSensitive=true] - If false, lowercase all keys
   * @param {boolean} [multiValue=false] - If true, only the first value of a duplicate key is kept
   * @param {boolean} [sanitizeKeys=false] - If true, skip entries with falsy keys
   * @returns {object}
   */
  toObject(excludeDisabled = true, caseSensitive, multiValue, sanitizeKeys) {
    return headerEntriesToObject(this.all(), excludeDisabled, caseSensitive, multiValue, sanitizeKeys);
  }

  #write({ key, value, disabled }) {
    const entries = liveHeaderEntries(this.#request);
    // A server reads `X-Token` and `x-token` as one key, so a re-cased write replaces in place
    // instead of leaving two entries the transport would send as duplicates.
    const existing = entries.find((entry) => this._keyMatches(entry.key, key));

    if (existing) {
      existing.key = key;
      existing.value = value;
      if (disabled) {
        existing.disabled = true;
      } else {
        delete existing.disabled;
      }
    } else {
      entries.push(disabled ? { key, value, disabled: true } : { key, value });
    }

    projectHeaderEntries(entries, this.#request.headers);
  }
}

module.exports = GrpcMetadataList;
