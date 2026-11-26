import { ensureString } from './values';

const WIRE_TYPES = Object.freeze({
  VARINT: 0,
  FIXED64: 1,
  LENGTH_DELIMITED: 2,
  FIXED32: 5
});

// Field numbers from protobuf's descriptor.proto, down the path FileDescriptorSet → file → service → method.
const DESCRIPTOR_FIELDS = Object.freeze({
  FILE: 1,
  SERVICE: 6,
  METHOD: 2,
  METHOD_NAME: 1,
  CLIENT_STREAMING: 5,
  SERVER_STREAMING: 6
});

// Postman's cloud export joins service and method with a dot (`pkg.Service.Method`); its v3 YAML uses `pkg.Service/Method`.
const splitMethodPath = (methodPath) => {
  const path = ensureString(methodPath).trim().replace(/^\//, '');
  const separatorIndex = path.includes('/') ? path.lastIndexOf('/') : path.lastIndexOf('.');
  if (separatorIndex <= 0) return { service: '', method: path };

  return { service: path.slice(0, separatorIndex), method: path.slice(separatorIndex + 1) };
};

/**
 * Bruno addresses a method by its gRPC path, `/pkg.Service/Method`. A path without a service is
 * returned unchanged.
 */
export const toBrunoGrpcMethod = (methodPath) => {
  const { service, method } = splitMethodPath(methodPath);
  return service ? `/${service}/${method}` : method;
};

const decodeBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/**
 * Reads the top-level fields of one protobuf message as `{ number, value }`: a number for a
 * varint, the raw bytes for a string or nested message. Fixed-width fields are skipped.
 */
const readFields = (bytes) => {
  const fields = [];
  let offset = 0;

  const readVarint = () => {
    let value = 0;
    let scale = 1;

    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return value;
      scale *= 128;
    }

    throw new Error('Truncated varint');
  };

  while (offset < bytes.length) {
    const tag = readVarint();
    const number = Math.floor(tag / 8);
    const wireType = tag % 8;

    if (wireType === WIRE_TYPES.VARINT) {
      fields.push({ number, value: readVarint() });
    } else if (wireType === WIRE_TYPES.LENGTH_DELIMITED) {
      const length = readVarint();
      const end = offset + length;
      if (end > bytes.length) throw new Error('Truncated field');
      fields.push({ number, value: bytes.subarray(offset, end) });
      offset = end;
    } else if (wireType === WIRE_TYPES.FIXED64) {
      offset += 8;
    } else if (wireType === WIRE_TYPES.FIXED32) {
      offset += 4;
    } else {
      throw new Error(`Unsupported wire type ${wireType}`);
    }
  }

  return fields;
};

const readNestedMessages = (bytes, fieldNumber) => readFields(bytes)
  .filter((field) => field.number === fieldNumber && field.value instanceof Uint8Array)
  .map((field) => field.value);

const hasFlag = (fields, fieldNumber) => fields.some((field) => field.number === fieldNumber && field.value === 1);

const hasName = (fields, name) => fields.some((field) => {
  return field.number === DESCRIPTOR_FIELDS.METHOD_NAME
    && field.value instanceof Uint8Array
    && new TextDecoder().decode(field.value) === name;
});

/**
 * Postman's `methodDescriptor` is a base64 protobuf FileDescriptorSet holding the selected method,
 * the only place an export records whether the call streams. Returns '' when it can't be read, so
 * Bruno resolves the type itself when the request connects.
 */
export const readGrpcMethodType = (methodDescriptor, methodPath) => {
  if (typeof methodDescriptor !== 'string' || !methodDescriptor) return '';

  try {
    const { method: methodName } = splitMethodPath(methodPath);
    const method = readNestedMessages(decodeBase64(methodDescriptor), DESCRIPTOR_FIELDS.FILE)
      .flatMap((file) => readNestedMessages(file, DESCRIPTOR_FIELDS.SERVICE))
      .flatMap((service) => readNestedMessages(service, DESCRIPTOR_FIELDS.METHOD))
      .map(readFields)
      .find((fields) => hasName(fields, methodName));
    if (!method) return '';

    const clientStreaming = hasFlag(method, DESCRIPTOR_FIELDS.CLIENT_STREAMING);
    const serverStreaming = hasFlag(method, DESCRIPTOR_FIELDS.SERVER_STREAMING);

    if (clientStreaming && serverStreaming) return 'bidi-streaming';
    if (clientStreaming) return 'client-streaming';
    if (serverStreaming) return 'server-streaming';
    return 'unary';
  } catch {
    return '';
  }
};
