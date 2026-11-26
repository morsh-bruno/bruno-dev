/**
 * Builds a minimal Postman v2.1 collection around the given items.
 *
 * @param {Array<Object>} items - Postman items (requests or folders), e.g. from {@link makeRequest}.
 * @param {Object} [overrides] - Top-level fields merged over the collection (e.g. `variable`, `auth`).
 * @returns {Object} A collection object as postmanToBruno expects it.
 */
export const makeCollection = (items, overrides = {}) => ({
  info: {
    _postman_id: 'test-id',
    name: 'Test Collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  item: items,
  ...overrides
});

/**
 * The `item.protocolProfileBehavior` fields the Bruno importer reads. Postman types them, but real
 * exports are not guaranteed to honour that, so importer tests pass unexpected values here too.
 * Any other field Postman sends is ignored on import.
 *
 * @typedef {Object} ProtocolProfileBehavior
 * @property {boolean} [followRedirects] - Maps to Bruno's followRedirects setting.
 * @property {number} [maxRedirects] - Maps to Bruno's maxRedirects setting.
 * @property {boolean} [followAuthorizationHeader] - Maps to Bruno's forwardAuthorizationHeader setting.
 * @property {boolean} [disableUrlEncoding] - Inverted into Bruno's encodeUrl setting.
 */

/**
 * Builds a minimal Postman request item.
 *
 * @param {string} name - The request name, also used as the issue path in import warnings.
 * @param {Object} [options]
 * @param {string} [options.method='GET'] - HTTP method.
 * @param {string} [options.url='https://example.com'] - Raw request URL.
 * @param {ProtocolProfileBehavior} [options.protocolProfileBehavior] - Omitted from the item when falsy.
 * @returns {Object} A request item for {@link makeCollection}.
 */
export const makeRequest = (name, { method = 'GET', url = 'https://example.com', protocolProfileBehavior } = {}) => ({
  name,
  ...(protocolProfileBehavior ? { protocolProfileBehavior } : {}),
  request: {
    method,
    header: [],
    url: { raw: url, protocol: 'https', host: ['example', 'com'] }
  }
});

/**
 * Builds a minimal Postman v3 collection (the `$kind`-tagged format) around the given items.
 *
 * @param {Array<Object>} items - v3 items, e.g. from {@link makeV3Request} or {@link makeV3Folder}.
 * @param {Object} [overrides] - Top-level fields merged over the collection (e.g. `auth`, `scripts`, `variables`).
 * @returns {Object} A collection object as postmanToBruno expects it.
 */
export const makeV3Collection = (items, overrides = {}) => ({
  id: 'test-id',
  name: 'Test Collection',
  $kind: 'collection',
  scripts: [],
  items,
  ...overrides
});

/**
 * Builds a v3 folder. In v3 a folder is a nested `$kind: 'collection'` item.
 *
 * @param {string} name - The folder name.
 * @param {Array<Object>} items - The folder's child items.
 * @param {Object} [overrides] - Fields merged over the folder (e.g. `auth`, `scripts`, `description`).
 * @returns {Object} A folder item for {@link makeV3Collection}.
 */
export const makeV3Folder = (name, items, overrides = {}) => ({
  name,
  $kind: 'collection',
  scripts: [],
  items,
  ...overrides
});

/**
 * Builds a v3 HTTP request item.
 *
 * @param {string} name - The request name, also used as the issue path in import warnings.
 * @param {Object} [overrides] - Fields merged over the request (e.g. `method`, `body`, `auth`, `settings`).
 * @returns {Object} A request item for {@link makeV3Collection} or {@link makeV3Folder}.
 */
export const makeV3Request = (name, overrides = {}) => ({
  name,
  $kind: 'http-request',
  url: 'https://example.com',
  method: 'GET',
  headers: [],
  ...overrides
});

/**
 * Builds a v3 gRPC request item, shaped like `postman collection get <id> --json` emits one that
 * has no method selected yet.
 *
 * @param {string} name - The request name, also used as the issue path in import warnings.
 * @param {Object} [overrides] - Fields merged over the request (e.g. `methodPath`, `metadata`, `schema`).
 * @returns {Object} A request item for {@link makeV3Collection} or {@link makeV3Folder}.
 */
export const makeV3GrpcRequest = (name, overrides = {}) => ({
  name,
  $kind: 'grpc-request',
  url: 'grpcb.in:9001',
  metadata: [],
  methodPath: '',
  message: { content: '' },
  schema: { source: 'none' },
  scripts: [],
  settings: {},
  ...overrides
});

/**
 * `methodDescriptor` values Postman exported for hello.HelloService, one per call type, keyed by
 * the `methodPath` they belong to.
 */
export const V3_GRPC_METHOD_DESCRIPTORS = Object.freeze({
  'hello.HelloService.SayHello': 'CqUBCgtoZWxsby5wcm90bxIFaGVsbG8iJAoMSGVsbG9SZXF1ZXN0EhQKCGdyZWV0aW5nGAEgASgJQgIQACIiCg1IZWxsb1Jlc3BvbnNlEhEKBXJlcGx5GAEgASgJQgIQADJFCgxIZWxsb1NlcnZpY2USNQoIU2F5SGVsbG8SEy5oZWxsby5IZWxsb1JlcXVlc3QaFC5oZWxsby5IZWxsb1Jlc3BvbnNl',
  'hello.HelloService.LotsOfReplies': 'CqwBCgtoZWxsby5wcm90bxIFaGVsbG8iJAoMSGVsbG9SZXF1ZXN0EhQKCGdyZWV0aW5nGAEgASgJQgIQACIiCg1IZWxsb1Jlc3BvbnNlEhEKBXJlcGx5GAEgASgJQgIQADJMCgxIZWxsb1NlcnZpY2USPAoNTG90c09mUmVwbGllcxITLmhlbGxvLkhlbGxvUmVxdWVzdBoULmhlbGxvLkhlbGxvUmVzcG9uc2UwAQ==',
  'hello.HelloService.LotsOfGreetings': 'Cq4BCgtoZWxsby5wcm90bxIFaGVsbG8iJAoMSGVsbG9SZXF1ZXN0EhQKCGdyZWV0aW5nGAEgASgJQgIQACIiCg1IZWxsb1Jlc3BvbnNlEhEKBXJlcGx5GAEgASgJQgIQADJOCgxIZWxsb1NlcnZpY2USPgoPTG90c09mR3JlZXRpbmdzEhMuaGVsbG8uSGVsbG9SZXF1ZXN0GhQuaGVsbG8uSGVsbG9SZXNwb25zZSgB',
  'hello.HelloService.BidiHello': 'CqoBCgtoZWxsby5wcm90bxIFaGVsbG8iJAoMSGVsbG9SZXF1ZXN0EhQKCGdyZWV0aW5nGAEgASgJQgIQACIiCg1IZWxsb1Jlc3BvbnNlEhEKBXJlcGx5GAEgASgJQgIQADJKCgxIZWxsb1NlcnZpY2USOgoJQmlkaUhlbGxvEhMuaGVsbG8uSGVsbG9SZXF1ZXN0GhQuaGVsbG8uSGVsbG9SZXNwb25zZSgBMAE='
});
