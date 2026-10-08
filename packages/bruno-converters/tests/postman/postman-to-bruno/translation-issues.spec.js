import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import postmanToBruno from '../../../src/postman/postman-to-bruno';
import { makeCollection, makeRequest } from '../../common/postman-collection';

// The closing `});` is missing, so the AST translator cannot parse it and falls back.
const unparsableScript = ['pm.test("status is 200", function () {', '  pm.response.to.have.status(200);'];
const validScript = ['pm.environment.set("token", "abc");'];

const preRequestEvent = (exec) => ({ listen: 'prerequest', script: { type: 'text/javascript', exec } });
const withEvents = (item, ...events) => ({ ...item, event: events });

const translationWarning = /^Script translation fell back to (regex replacement|the original Postman script): .+/;

describe('postmanToBruno translation issues', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('reports a request script that fails AST translation without touching issues', async () => {
    const collection = makeCollection([withEvents(makeRequest('Broken Script'), preRequestEvent(unparsableScript))]);

    const { collection: bruno, issues, translationIssues } = await postmanToBruno(collection);

    expect(issues).toEqual([]);
    expect(translationIssues).toHaveLength(1);
    expect(translationIssues[0]).toMatchObject({ path: 'Broken Script', severity: 'warning' });
    expect(translationIssues[0].message).toMatch(translationWarning);
    expect(translationIssues[0].message.split('\n')).toHaveLength(1);

    expect(bruno.items[0].request.script.req).toContain('status is 200');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('reports collection and folder level scripts under their own paths', async () => {
    const folder = {
      name: 'Folder',
      event: [preRequestEvent(unparsableScript)],
      item: [withEvents(makeRequest('Nested'), preRequestEvent(unparsableScript))]
    };
    const collection = makeCollection([folder], { event: [preRequestEvent(unparsableScript)] });

    const { issues, translationIssues } = await postmanToBruno(collection);

    expect(issues).toEqual([]);
    expect(translationIssues.map((issue) => issue.path).sort()).toEqual(['Collection', 'Folder', 'Folder / Nested']);
    expect(translationIssues.every((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('reports nothing when every script translates', async () => {
    const collection = makeCollection([withEvents(makeRequest('Fine'), preRequestEvent(validScript))]);

    const { collection: bruno, issues, translationIssues } = await postmanToBruno(collection);

    expect(issues).toEqual([]);
    expect(translationIssues).toEqual([]);
    expect(bruno.items[0].request.script.req).toContain('bru.setEnvVar');
  });

  it('reports nothing when scripts are preserved verbatim', async () => {
    const collection = makeCollection([withEvents(makeRequest('Preserved'), preRequestEvent(unparsableScript))]);

    const { collection: bruno, translationIssues } = await postmanToBruno(collection, { preserveScripts: true });

    expect(translationIssues).toEqual([]);
    expect(bruno.items[0].request.script.req).toBe(unparsableScript.join('\n'));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
