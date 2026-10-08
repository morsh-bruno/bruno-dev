const chalk = require('chalk');
const { REQUEST_ITEM_TYPES } = require('./collection');

const countItems = (items = []) => {
  const counts = { requests: 0, folders: 0 };

  for (const item of items) {
    if (item.type === 'folder') {
      counts.folders += 1;
      const nested = countItems(item.items);
      counts.requests += nested.requests;
      counts.folders += nested.folders;
    } else if (REQUEST_ITEM_TYPES.includes(item.type)) {
      counts.requests += 1;
    }
  }

  return counts;
};

const formatImportSummary = (collection) => {
  const { requests, folders } = countItems(collection.items);
  const environments = (collection.environments || []).length;

  let summary = `Imported ${requests} requests in ${folders} folders`;
  if (environments) {
    summary += `, ${environments} environments`;
  }
  return summary;
};

const hasImportErrors = (issues = []) => issues.some((issue) => issue.severity === 'error');

/**
 * Mirrors the app's import toast: a skipped/warning count, then one line per issue. `sourceItem`
 * is never printed; it is the raw Postman item and can be arbitrarily large.
 */
const formatImportIssues = (issues = []) => {
  if (!issues.length) {
    return '';
  }

  const skipped = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - skipped;
  const lines = [`${skipped} item(s) skipped, ${warnings} warning(s)`];

  for (const { path, severity, message } of issues) {
    if (severity === 'error') {
      lines.push(chalk.red(`  error   [${path}] ${message}`));
    } else {
      lines.push(chalk.yellow(`  warning [${path}] ${message}`));
    }
  }

  return lines.join('\n');
};

// Informational only: the report never affects the exit code.
const formatPackageReport = (packageReport) => {
  if (!packageReport || !packageReport.hasAny) {
    return '';
  }

  const { needsInstall = [], unsupported = [], devMode = [] } = packageReport;
  const lines = ['Packages referenced by scripts:'];

  if (needsInstall.length) {
    lines.push(`  needs install:        ${needsInstall.join(', ')}   (run inside the collection: npm install --save ${needsInstall.join(' ')})`);
  }
  if (unsupported.length) {
    lines.push(`  unsupported:          ${unsupported.join(', ')}   (no Bruno equivalent; scripts using it will fail)`);
  }
  if (devMode.length) {
    lines.push(`  developer mode only:  ${devMode.join(', ')}   (available only with the developer-mode sandbox)`);
  }

  return lines.join('\n');
};

module.exports = {
  formatImportSummary,
  formatImportIssues,
  formatPackageReport,
  hasImportErrors
};
