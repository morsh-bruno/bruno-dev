const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const { resolveLocalWsdlSchemaRef, readPostmanFile, fetchSourceFromUrl, readOpenApiFile } = require('../../src/commands/import');

describe('readPostmanFile', () => {
  let dir;
  let logSpy;

  beforeAll(() => {
    dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-cli-postman-read-')));
    fs.writeFileSync(path.join(dir, 'collection.json'), JSON.stringify({ info: { name: 'From file' }, item: [] }));
    fs.writeFileSync(path.join(dir, 'collection.yml'), 'info:\n  name: Not JSON\n');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('parses a local JSON file', async () => {
    await expect(readPostmanFile(path.join(dir, 'collection.json'))).resolves.toEqual({ info: { name: 'From file' }, item: [] });
  });

  it('rejects a file that is not JSON, without falling back to YAML', async () => {
    const source = path.join(dir, 'collection.yml');

    await expect(readPostmanFile(source)).rejects.toThrow(`Failed to parse Postman JSON from ${source}`);
  });

  it('keeps the missing-file message shared with the other readers', async () => {
    const source = path.join(dir, 'missing.json');

    await expect(readPostmanFile(source)).rejects.toThrow(`File does not exist: ${source}`);
  });

  describe('from a URL', () => {
    let server;
    let baseUrl;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === '/collection.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ info: { name: 'From url' }, item: [] }));
        } else if (req.url === '/collection.txt') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(JSON.stringify({ info: { name: 'From text url' }, item: [] }));
        } else if (req.url === '/spec.yml') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('openapi: 3.0.0\n');
        } else {
          res.writeHead(404, 'Not Found');
          res.end();
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('uses the object axios already parsed for a JSON response', async () => {
      await expect(readPostmanFile(`${baseUrl}/collection.json`)).resolves.toEqual({ info: { name: 'From url' }, item: [] });
    });

    it('parses a JSON body served as text', async () => {
      await expect(readPostmanFile(`${baseUrl}/collection.txt`)).resolves.toEqual({ info: { name: 'From text url' }, item: [] });
    });

    it('rejects a non-JSON body', async () => {
      await expect(readPostmanFile(`${baseUrl}/spec.yml`)).rejects.toThrow('Failed to parse Postman JSON from');
    });

    it('surfaces an HTTP failure through the shared fetch helper', async () => {
      await expect(fetchSourceFromUrl(`${baseUrl}/missing.json`)).rejects.toThrow('Failed to fetch from URL: 404 Not Found');
    });

    it('still lets the OpenAPI reader fall back to YAML', async () => {
      await expect(readOpenApiFile(`${baseUrl}/spec.yml`)).resolves.toEqual({ openapi: '3.0.0' });
    });
  });
});

// Mirrors bruno-electron/tests/ipc/wsdl.test.js
describe('resolveLocalWsdlSchemaRef', () => {
  let dir;
  let wsdlPath;
  let commonPath;

  beforeAll(() => {
    dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-cli-wsdl-')));
    fs.mkdirSync(path.join(dir, 'wsdl'));
    fs.mkdirSync(path.join(dir, 'schema'));
    wsdlPath = path.join(dir, 'wsdl', 'Service.wsdl');
    commonPath = path.join(dir, 'schema', 'Common.xsd');
    fs.writeFileSync(wsdlPath, '<definitions/>');
    fs.writeFileSync(commonPath, '<schema/>');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'SECRET');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('joins a ref against an absolute path base and against a file:// base', async () => {
    const firstHop = await resolveLocalWsdlSchemaRef(wsdlPath, '../schema/Common.xsd');

    expect(firstHop.text).toBe('<schema/>');
    expect(firstHop.uri).toBe(pathToFileURL(commonPath).href);
    expect(firstHop.key).toBe(pathToFileURL(commonPath).href);

    const secondHop = await resolveLocalWsdlSchemaRef(firstHop.uri, '../wsdl/Service.wsdl');

    expect(secondHop.text).toBe('<definitions/>');
    expect(secondHop.uri).toBe(pathToFileURL(wsdlPath).href);
    expect(secondHop.key).toBe(pathToFileURL(wsdlPath).href);
  });

  it('refuses a ref pointing at a non-schema file', async () => {
    await expect(resolveLocalWsdlSchemaRef(wsdlPath, '../secret.txt')).rejects.toThrow(
      /must point at a .xsd\/.wsdl file/
    );
  });

  it('rejects a non-string base uri', async () => {
    await expect(resolveLocalWsdlSchemaRef(undefined, '../schema/Common.xsd')).rejects.toThrow(
      /Invalid base URI/
    );
  });

  it('rejects a non-string schema reference', async () => {
    await expect(resolveLocalWsdlSchemaRef(wsdlPath, undefined)).rejects.toThrow(/Invalid schema reference/);
  });
});
