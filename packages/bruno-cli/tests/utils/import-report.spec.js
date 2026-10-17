const { describe, it, expect } = require('@jest/globals');
const {
  formatImportSummary,
  formatImportIssues,
  formatPackageReport,
  hasImportErrors
} = require('../../src/utils/import-report');

const request = (name) => ({ type: 'http-request', name });
const folder = (name, items) => ({ type: 'folder', name, items });

const errorIssue = { path: 'Broken', severity: 'error', message: 'Missing or invalid request method', sourceItem: { huge: true } };
const warningIssue = { path: 'Folder / Degraded', severity: 'warning', message: 'Invalid maxRedirects, ignored' };

describe('formatImportSummary', () => {
  it('counts requests across nested folders', () => {
    const collection = {
      items: [
        request('A'),
        folder('F1', [request('B'), folder('F2', [request('C'), { type: 'graphql-request', name: 'D' }])]),
        folder('Empty', [])
      ]
    };

    expect(formatImportSummary(collection)).toBe('Imported 4 requests in 3 folders');
  });

  it('mentions environments only when there are some', () => {
    expect(formatImportSummary({ items: [request('A')], environments: [] })).toBe('Imported 1 requests in 0 folders');
    expect(formatImportSummary({ items: [request('A')], environments: [{ name: 'dev' }, { name: 'prod' }] })).toBe(
      'Imported 1 requests in 0 folders, 2 environments'
    );
  });

  it('handles a collection without items', () => {
    expect(formatImportSummary({})).toBe('Imported 0 requests in 0 folders');
  });
});

describe('formatImportIssues', () => {
  it('prints nothing for an empty list', () => {
    expect(formatImportIssues([])).toBe('');
    expect(formatImportIssues()).toBe('');
  });

  it('lists errors with the app wording and never prints sourceItem', () => {
    const text = formatImportIssues([errorIssue]);

    expect(text.split('\n')).toEqual([
      '1 item(s) skipped, 0 warning(s)',
      '  error   [Broken] Missing or invalid request method'
    ]);
    expect(text).not.toContain('huge');
  });

  it('lists warnings only', () => {
    expect(formatImportIssues([warningIssue]).split('\n')).toEqual([
      '0 item(s) skipped, 1 warning(s)',
      '  warning [Folder / Degraded] Invalid maxRedirects, ignored'
    ]);
  });

  it('keeps the input order for a mixed list', () => {
    expect(formatImportIssues([warningIssue, errorIssue, warningIssue]).split('\n')).toEqual([
      '1 item(s) skipped, 2 warning(s)',
      '  warning [Folder / Degraded] Invalid maxRedirects, ignored',
      '  error   [Broken] Missing or invalid request method',
      '  warning [Folder / Degraded] Invalid maxRedirects, ignored'
    ]);
  });
});

describe('hasImportErrors', () => {
  it('is true only when an error-severity issue is present', () => {
    expect(hasImportErrors([])).toBe(false);
    expect(hasImportErrors()).toBe(false);
    expect(hasImportErrors([warningIssue])).toBe(false);
    expect(hasImportErrors([warningIssue, errorIssue])).toBe(true);
  });
});

describe('formatPackageReport', () => {
  it('prints nothing without a report or when nothing needs attention', () => {
    expect(formatPackageReport(undefined)).toBe('');
    expect(formatPackageReport({ safeMode: ['lodash'], devMode: [], needsInstall: [], unsupported: [], hasAny: false })).toBe('');
  });

  it('prints each populated bucket', () => {
    const text = formatPackageReport({
      safeMode: ['lodash'],
      needsInstall: ['moment', 'uuid'],
      unsupported: ['postman-collection'],
      devMode: ['fs', 'path'],
      hasAny: true
    });

    expect(text.split('\n')).toEqual([
      'Packages referenced by scripts:',
      '  needs install:        moment, uuid   (run inside the collection: npm install --save moment uuid)',
      '  unsupported:          postman-collection   (no Bruno equivalent; scripts using it will fail)',
      '  developer mode only:  fs, path   (available only with the developer-mode sandbox)'
    ]);
    expect(text).not.toContain('lodash');
  });

  it('skips empty buckets', () => {
    const text = formatPackageReport({ safeMode: [], needsInstall: [], unsupported: [], devMode: ['crypto'], hasAny: true });

    expect(text.split('\n')).toEqual([
      'Packages referenced by scripts:',
      '  developer mode only:  crypto   (available only with the developer-mode sandbox)'
    ]);
  });
});
