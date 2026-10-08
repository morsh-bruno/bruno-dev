const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { parseCollection, parseFolder, parseRequest, parseEnvironment } = require('@usebruno/filestore');
const { runCli } = require('./helpers/run-cli');

const FIXTURES = path.join(__dirname, 'import-postman', 'fixtures');
const fixture = (name) => path.join(FIXTURES, name);

const parseYml = (parse, filePath) => parse(fs.readFileSync(filePath, 'utf8'), { format: 'yml' });
const parseBru = (parse, filePath) => parse(fs.readFileSync(filePath, 'utf8'), { format: 'bru' });

const stackTracePattern = /Babel|SyntaxError|^\s+at .+\(.+\)$/m;

describe('CLI import postman', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bru-cli-import-postman-')));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  const importTo = (dirName, args) => {
    const outputDir = path.join(tmpDir, dirName);
    return runCli(['import', 'postman', '-o', outputDir, ...args], tmpDir).then((result) => ({ ...result, outputDir }));
  };

  it('writes an OpenCollection directory by default and reports a summary', async () => {
    const { code, stdout, outputDir } = await importTo('runnable', ['-s', fixture('runnable.postman_collection.json')]);

    expect(code).toBe(0);
    expect(stdout).toContain('Imported 2 requests in 1 folders');

    const collection = parseYml(parseCollection, path.join(outputDir, 'opencollection.yml'));
    expect(collection.brunoConfig.name).toBe('Runnable Collection');
    expect(collection.collectionRoot.request.auth.mode).toBe('bearer');
    expect(collection.collectionRoot.request.auth.bearer.token).toBe('{{token}}');
    expect(collection.collectionRoot.request.vars.req).toEqual([expect.objectContaining({ name: 'token', value: 'collection-token' })]);
    expect(collection.collectionRoot.request.script.req).toContain('bru.setCollectionVar');

    const folder = parseYml(parseFolder, path.join(outputDir, 'Users', 'folder.yml'));
    expect(folder.meta.name).toBe('Users');

    const ping = parseYml(parseRequest, path.join(outputDir, 'Ping.yml'));
    expect(ping.name).toBe('Ping');
    expect(ping.request.method).toBe('GET');
    expect(ping.request.url).toBe('{{baseUrl}}/ping');
    expect(ping.request.headers).toEqual([expect.objectContaining({ name: 'X-Client', value: 'bruno-cli' })]);
    expect(ping.request.auth.mode).toBe('inherit');
    expect(ping.request.script.req).toContain('bru.setEnvVar');
    expect(ping.request.script.res).toContain('expect(res.getStatus()).to.equal(200)');
    expect(ping.examples).toHaveLength(1);
    expect(ping.examples[0].name).toBe('Pong');

    const createUser = parseYml(parseRequest, path.join(outputDir, 'Users', 'Create User.yml'));
    expect(createUser.request.method).toBe('POST');
    expect(createUser.request.body.mode).toBe('json');
    expect(createUser.request.body.json).toContain('"name": "Ada"');
  });

  it('writes a bru collection with --collection-format bru', async () => {
    const { code, outputDir } = await importTo('runnable-bru', ['-s', fixture('runnable.postman_collection.json'), '--collection-format', 'bru']);

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(outputDir, 'bruno.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'collection.bru'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'Users', 'folder.bru'))).toBe(true);

    const ping = parseBru(parseRequest, path.join(outputDir, 'Ping.bru'));
    expect(ping.request.url).toBe('{{baseUrl}}/ping');
    expect(ping.examples).toHaveLength(1);
  });

  it('preserves per-request settings such as omitHeaders', async () => {
    const { code, outputDir } = await importTo('settings', ['-s', fixture('postman-with-settings.json')]);

    expect(code).toBe(0);
    const request = parseYml(parseRequest, path.join(outputDir, 'Request with Auth Forwarding.yml'));
    expect(request.settings).toMatchObject({
      omitHeaders: ['user-agent', 'accept-encoding'],
      followRedirects: true,
      maxRedirects: 10,
      encodeUrl: false
    });
  });

  it('translates scripts unless --preserve-scripts is passed', async () => {
    const translated = await importTo('translated', ['-s', fixture('postman-with-scripts.json')]);
    expect(translated.code).toBe(0);
    const translatedLogin = parseYml(parseRequest, path.join(translated.outputDir, 'Login.yml'));
    expect(translatedLogin.request.script.req).toContain('bru.setEnvVar');
    expect(translatedLogin.request.script.res).toContain('res.getStatus()');
    expect(`${translatedLogin.request.script.req}${translatedLogin.request.script.res}`).not.toContain('pm.');

    const preserved = await importTo('preserved', ['-s', fixture('postman-with-scripts.json'), '--preserve-scripts']);
    expect(preserved.code).toBe(0);
    const preservedLogin = parseYml(parseRequest, path.join(preserved.outputDir, 'Login.yml'));
    expect(preservedLogin.request.script.req).toContain('pm.environment.set');
    expect(preservedLogin.request.script.res).toContain('pm.response.to.have.status(200)');
  });

  it('prints every converter issue, still writes the collection and exits 1 on errors', async () => {
    const { code, stdout, outputDir } = await importTo('issues', ['-s', fixture('postman-with-import-issues.json')]);

    expect(code).toBe(1);
    expect(stdout).toContain('6 item(s) skipped, 0 warning(s)');
    expect(stdout.match(/^\s+error\s+\[.+\] Missing or invalid request method$/gm)).toHaveLength(6);
    expect(stdout).toContain('[API Folder / Deep Subfolder / Deep Bad Method]');

    expect(fs.existsSync(path.join(outputDir, 'opencollection.yml'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'Valid GET Request.yml'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'API Folder', 'Deep Subfolder', 'Deep Valid Request.yml'))).toBe(true);
  });

  it('reports a script that fails AST translation as a single warning line', async () => {
    const { code, stdout, stderr, outputDir } = await importTo('ast', ['-s', fixture('scripts-ast-failure.postman_collection.json')]);

    expect(code).toBe(0);
    expect(stdout).toContain('0 item(s) skipped, 1 warning(s)');
    expect(stdout.match(/^\s+warning\s+\[Broken Script\] Script translation fell back to .+$/gm)).toHaveLength(1);
    expect(stdout).not.toMatch(stackTracePattern);
    expect(stderr).not.toMatch(stackTracePattern);

    const request = parseYml(parseRequest, path.join(outputDir, 'Broken Script.yml'));
    expect(request.request.script.req).toContain('never closed');
  });

  it.each([
    ['an unsupported schema', 'postman-invalid-schema.json'],
    ['a malformed collection', 'postman-malformed.json']
  ])('exits 1 without a stack trace or output directory for %s', async (_label, fixtureName) => {
    const { code, stderr, outputDir } = await importTo('fatal', ['-s', fixture(fixtureName)]);

    expect(code).toBe(1);
    expect(stderr).toContain('Error: Import collection failed');
    expect(stderr).not.toMatch(stackTracePattern);
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it('refuses to write into a non-empty collection subdirectory', async () => {
    const existingOutput = path.join(tmpDir, 'existing');
    fs.mkdirSync(path.join(existingOutput, 'Runnable Collection'), { recursive: true });
    fs.writeFileSync(path.join(existingOutput, 'Runnable Collection', 'keep.txt'), 'keep');

    const { code, stderr } = await runCli(
      ['import', 'postman', '-s', fixture('runnable.postman_collection.json'), '-o', existingOutput],
      tmpDir
    );

    expect(code).toBe(1);
    expect(stderr).toContain('Output directory is not empty');
  });

  it('converts --environment exports into the environments directory', async () => {
    const { code, stdout, outputDir } = await importTo('with-env', [
      '-s', fixture('runnable.postman_collection.json'),
      '-e', fixture('staging.postman_environment.json')
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Imported 2 requests in 1 folders, 1 environments');

    const environment = parseYml(parseEnvironment, path.join(outputDir, 'environments', 'staging.yml'));
    expect(environment.name).toBe('staging');
    expect(environment.variables.map(({ name, enabled, secret }) => ({ name, enabled, secret }))).toEqual([
      { name: 'baseUrl', enabled: true, secret: false },
      { name: 'apiKey', enabled: true, secret: true },
      { name: 'debug', enabled: false, secret: false }
    ]);
  });

  it('writes a JSON dump without packageReport via --output-file, carrying environments', async () => {
    const outputFile = path.join(tmpDir, 'collection.json');
    const plain = await runCli(['import', 'postman', '-s', fixture('runnable.postman_collection.json'), '-f', outputFile], tmpDir);

    expect(plain.code).toBe(0);
    const dumped = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    expect(dumped.items).toHaveLength(2);
    expect(dumped).not.toHaveProperty('packageReport');
    expect(dumped.environments).toEqual([]);

    const withEnv = await runCli(
      ['import', 'postman', '-s', fixture('runnable.postman_collection.json'), '-f', outputFile, '-e', fixture('staging.postman_environment.json')],
      tmpDir
    );

    expect(withEnv.code).toBe(0);
    const dumpedWithEnv = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    expect(dumpedWithEnv.environments).toHaveLength(1);
    expect(dumpedWithEnv.environments[0].name).toBe('staging');
  });

  describe('postman-env', () => {
    const envSource = fixture('staging.postman_environment.json');

    it('writes into <collection>/environments and never overwrites', async () => {
      const { outputDir } = await importTo('target', ['-s', fixture('postman-v21.json')]);

      const first = await runCli(['import', 'postman-env', '-s', envSource, '-o', outputDir], tmpDir);
      const envPath = path.join(outputDir, 'environments', 'staging.yml');
      expect(first.code).toBe(0);
      expect(first.stdout).toContain(`Environment "staging" written to ${envPath}`);

      const environment = parseYml(parseEnvironment, envPath);
      expect(environment.variables.find((v) => v.name === 'apiKey').secret).toBe(true);
      expect(environment.variables.find((v) => v.name === 'debug').enabled).toBe(false);

      const second = await runCli(['import', 'postman-env', '-s', envSource, '-o', outputDir], tmpDir);
      expect(second.code).toBe(1);
      expect(second.stderr).toContain(`Environment file already exists: ${envPath}`);
    });

    it('accepts the environments directory itself and honours --collection-format bru', async () => {
      const { outputDir } = await importTo('target-bru', ['-s', fixture('postman-v21.json'), '--collection-format', 'bru']);

      const { code } = await runCli(
        ['import', 'postman-env', '-s', envSource, '-o', path.join(outputDir, 'environments'), '--collection-format', 'bru'],
        tmpDir
      );

      expect(code).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'environments', 'environments'))).toBe(false);

      const environment = parseBru(parseEnvironment, path.join(outputDir, 'environments', 'staging.bru'));
      expect(environment.variables.map(({ name, enabled, secret }) => ({ name, enabled, secret }))).toEqual([
        { name: 'baseUrl', enabled: true, secret: false },
        { name: 'debug', enabled: false, secret: false },
        { name: 'apiKey', enabled: true, secret: true }
      ]);
    });

    it('rejects --output-file and a missing collection directory', async () => {
      const toFile = await runCli(['import', 'postman-env', '-s', envSource, '-f', path.join(tmpDir, 'env.json')], tmpDir);
      expect(toFile.code).toBe(1);
      expect(toFile.stderr).toContain('--output-file is not supported for postman-env');

      const missing = await runCli(['import', 'postman-env', '-s', envSource, '-o', path.join(tmpDir, 'nope')], tmpDir);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain(`Collection directory does not exist: ${path.join(tmpDir, 'nope')}`);
    });
  });

  describe('bru run on the imported collection', () => {
    let server;
    let port;
    let received;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        received.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
        if (req.method === 'POST' && req.url === '/users') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 1 }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ping: 'pong' }));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(() => {
      received = [];
    });

    it('runs every imported request against the environment it was imported with', async () => {
      const envSource = path.join(tmpDir, 'local.postman_environment.json');
      fs.writeFileSync(envSource, JSON.stringify({
        name: 'local',
        values: [{ key: 'baseUrl', value: `http://127.0.0.1:${port}`, type: 'default', enabled: true }]
      }));

      const imported = await importTo('run-me', ['-s', fixture('runnable.postman_collection.json'), '-e', envSource]);
      expect(imported.code).toBe(0);

      const run = await runCli(['run', '--env', 'local', '--noproxy'], imported.outputDir);

      expect(run.stderr).toBe('');
      expect(run.code).toBe(0);
      expect(received.map(({ method, url }) => `${method} ${url}`).sort()).toEqual(['GET /ping', 'POST /users']);
      expect(received.every(({ authorization }) => authorization === 'Bearer collection-token')).toBe(true);
    });
  });

  it('lists the postman types in --help', async () => {
    const { code, stdout } = await runCli(['import', '--help'], tmpDir);

    expect(code).toBe(0);
    expect(stdout).toContain('"postman"');
    expect(stdout).toContain('"postman-env"');
    expect(stdout).toContain('--preserve-scripts');
    expect(stdout).toContain('--environment');
  });
});
