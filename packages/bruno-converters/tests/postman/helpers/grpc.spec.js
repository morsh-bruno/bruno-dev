import { describe, it, expect } from '@jest/globals';
import { readGrpcMethodType, toBrunoGrpcMethod } from '../../../src/postman/helpers/grpc';
import { V3_GRPC_METHOD_DESCRIPTORS } from '../../common/postman-collection';

describe('toBrunoGrpcMethod', () => {
  it.each([
    ['hello.HelloService.SayHello', '/hello.HelloService/SayHello'],
    ['hello.HelloService/SayHello', '/hello.HelloService/SayHello'],
    ['/hello.HelloService/SayHello', '/hello.HelloService/SayHello'],
    ['Greeter.SayHello', '/Greeter/SayHello'],
    ['  hello.HelloService.SayHello  ', '/hello.HelloService/SayHello'],
    ['SayHello', 'SayHello'],
    ['', ''],
    [undefined, '']
  ])('converts %p to %p', (methodPath, expected) => {
    expect(toBrunoGrpcMethod(methodPath)).toBe(expected);
  });
});

describe('readGrpcMethodType', () => {
  it.each([
    ['hello.HelloService.SayHello', 'unary'],
    ['hello.HelloService.LotsOfReplies', 'server-streaming'],
    ['hello.HelloService.LotsOfGreetings', 'client-streaming'],
    ['hello.HelloService.BidiHello', 'bidi-streaming']
  ])('reads %s as %s', (methodPath, expected) => {
    expect(readGrpcMethodType(V3_GRPC_METHOD_DESCRIPTORS[methodPath], methodPath)).toBe(expected);
  });

  it('reads the method type for a slash-separated method path', () => {
    const descriptor = V3_GRPC_METHOD_DESCRIPTORS['hello.HelloService.BidiHello'];

    expect(readGrpcMethodType(descriptor, 'hello.HelloService/BidiHello')).toBe('bidi-streaming');
  });

  it('returns an empty type when the descriptor does not hold the method', () => {
    const descriptor = V3_GRPC_METHOD_DESCRIPTORS['hello.HelloService.BidiHello'];

    expect(readGrpcMethodType(descriptor, 'hello.HelloService.SayHello')).toBe('');
  });

  it.each([
    ['a missing descriptor', undefined],
    ['an empty descriptor', ''],
    ['a descriptor that is not a string', { file: [] }],
    ['a descriptor that is not base64', 'not base64!'],
    ['a truncated descriptor', V3_GRPC_METHOD_DESCRIPTORS['hello.HelloService.BidiHello'].slice(0, 40)],
    ['bytes that are not a descriptor', 'aGVsbG8gd29ybGQ=']
  ])('returns an empty type for %s', (_, descriptor) => {
    expect(readGrpcMethodType(descriptor, 'hello.HelloService.BidiHello')).toBe('');
  });
});
