const ReadOnlyPropertyList = require('../readonly-property-list');
const {
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

  // ── Transform override ────────────────────────────────────────────────

  /** `key: value` per line — how metadata travels as HTTP/2 headers. */
  toString() {
    return this.all()
      .map((entry) => `${entry.key}: ${entry.value}`)
      .join('\n');
  }

  // ── Write methods (edit the entries, then project into the headers map) ──

  /**
   * Insert a key, or update it in place when it already exists.
   *
   * @param {string} key
   * @param {*} value
   */
  upsert(key, value) {
    this.#assertWritable('upsert');

    if (typeof key !== 'string' || !key.length) {
      return;
    }

    const entries = liveHeaderEntries(this.#request);
    const firstMatch = entries.find((entry) => this._keyMatches(entry.key, key));
    if (firstMatch && firstMatch.key !== key) {
      entries.splice(entries.indexOf(firstMatch), 1);
    }

    const existing = entries.find((entry) => entry.key === key);
    if (existing) {
      existing.value = value;
    } else {
      entries.push({ key, value });
    }

    projectHeaderEntries(entries, this.#request.headers);
  }

  /**
   * Upsert an entry from the `{ key, value }` shape `all()` returns, so an entry read from one list
   * can be handed straight to another.
   *
   * @param {object} item
   */
  add(item) {
    this.#assertWritable('add');

    if (!item || typeof item !== 'object') {
      return;
    }

    this.upsert(item.key, item.value);
  }

  /**
   * Remove the entry with the given key.
   * @param {string} key
   */
  remove(key) {
    this.#assertWritable('remove');

    const entries = liveHeaderEntries(this.#request);
    const index = entries.findIndex((entry) => this._keyMatches(entry.key, key));
    if (index !== -1) {
      entries.splice(index, 1);
    }

    projectHeaderEntries(entries, this.#request.headers);
  }

  /** Remove every entry. */
  clear() {
    this.#assertWritable('clear');

    const entries = liveHeaderEntries(this.#request);

    entries.length = 0;

    projectHeaderEntries(entries, this.#request.headers);
  }
}

module.exports = GrpcMetadataList;
