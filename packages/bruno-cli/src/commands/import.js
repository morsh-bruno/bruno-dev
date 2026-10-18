const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const chalk = require('chalk');
const jsyaml = require('js-yaml');
const axios = require('axios');
const { openApiToBruno, wsdlToBruno, postmanToBruno, postmanToBrunoEnvironment } = require('@usebruno/converters');
const { coerceEnvName, dedupeImportedSecrets } = require('@usebruno/common');
const { exists, isDirectory, sanitizeName, canonicalPath } = require('../utils/filesystem');
const { createCollectionFromBrunoObject, writeEnvironmentFile } = require('../utils/collection');
const { formatImportSummary, formatImportIssues, formatPackageReport, hasImportErrors } = require('../utils/import-report');

const command = 'import <type>';
const desc = 'Import a collection or environment from other formats (OpenAPI, WSDL, Postman)';

const IMPORT_TYPES = ['openapi', 'wsdl', 'postman', 'postman-env'];
const COLLECTION_FORMATS = ['bru', 'opencollection'];

const WSDL_MAX_SCHEMA_FILE_SIZE = 10 * 1024 * 1024;
const WSDL_SCHEMA_EXTENSIONS = ['.xsd', '.wsdl'];

const builder = (yargs) => {
  yargs
    .positional('type', {
      describe: 'Type of collection to import',
      type: 'string',
      choices: IMPORT_TYPES
    })
    .option('source', {
      alias: 's',
      describe: 'Path to the source file or URL',
      type: 'string',
      demandOption: true
    })
    .option('output', {
      alias: 'o',
      describe: 'Path to the output directory (for postman-env: the collection directory, or its environments directory)',
      type: 'string',
      conflicts: 'output-file'
    })
    .option('output-file', {
      alias: 'f',
      describe: 'Path to the output JSON file (not supported for postman-env)',
      type: 'string',
      conflicts: 'output'
    })
    .option('collection-name', {
      alias: 'n',
      describe: 'Name for the imported collection (ignored for postman-env)',
      type: 'string'
    })
    .option('collection-format', {
      describe: 'Format of the imported collection (bru or opencollection). If not specified, the default is `opencollection`',
      type: 'string',
      choices: COLLECTION_FORMATS,
      default: 'opencollection'
    })
    .option('insecure', {
      type: 'boolean',
      describe: 'Skip SSL certificate verification when fetching from URLs',
      default: false
    })
    .option('group-by', {
      alias: 'g',
      describe: 'How to group the imported requests: "tags" groups by OpenAPI tags, "path" groups by URL path structure (openapi only)',
      type: 'string',
      choices: ['tags', 'path'],
      default: 'tags'
    })
    .option('preserve-scripts', {
      describe: 'Preserve scripts (keep Postman scripts verbatim, no pm.* → bru.* translation) (postman only)',
      type: 'boolean',
      default: false
    })
    .option('environment', {
      alias: 'e',
      describe: 'Postman environment export(s) to convert alongside the collection (postman only)',
      type: 'array'
    })
    .example('$0 import openapi --source api.yml --output ~/Desktop/my-collection --collection-name "My API"')
    .example('$0 import openapi -s api.yml -o ~/Desktop/my-collection -n "My API"')
    .example('$0 import openapi --source https://example.com/api-spec.json --output ~/Desktop --collection-name "Remote API"')
    .example('$0 import openapi --source https://self-signed.example.com/api.json --insecure --output ~/Desktop')
    .example('$0 import openapi --source api.yml --output-file ~/Desktop/my-collection.json --collection-name "My API"')
    .example('$0 import openapi -s api.yml -f ~/Desktop/my-collection.json -n "My API"')
    .example('$0 import openapi --source api.yml --output ~/Desktop/my-collection --group-by path')
    .example('$0 import openapi -s api.yml -o ~/Desktop/my-collection -g tags')
    .example('$0 import wsdl --source service.wsdl --output ~/Desktop/soap-collection --collection-name "SOAP Service"')
    .example('$0 import wsdl -s https://example.com/service.wsdl -o ~/Desktop -n "Remote SOAP Service"')
    .example('$0 import postman --source my-api.postman_collection.json --output ~/Desktop/my-api')
    .example('$0 import postman -s my-api.postman_collection.json -o ~/Desktop/my-api -n "My API" --collection-format bru')
    .example('$0 import postman -s https://example.com/my-api.postman_collection.json -o ~/Desktop/my-api --preserve-scripts')
    .example('$0 import postman -s my-api.postman_collection.json -o ~/Desktop/my-api -e staging.postman_environment.json -e prod.postman_environment.json')
    .example('$0 import postman-env --source staging.postman_environment.json --output ~/Desktop/my-api');
};

const isUrl = (str) => {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
};

/**
 * Fetches a source over http(s) and returns the response body as axios delivered it: an object
 * when the server sent JSON, a string otherwise. `label` only names the source in the progress
 * line; the error messages are shared by every import type.
 */
const fetchSourceFromUrl = async (source, { insecure = false, label = 'source' } = {}) => {
  console.log(chalk.yellow(`Fetching ${label} from URL: ${source}`));
  try {
    const axiosOptions = {
      timeout: 30000, // 30 second timeout
      maxContentLength: 10 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300
    };

    // Skip SSL certificate validation if insecure flag is set
    if (insecure) {
      console.log(chalk.yellow('Warning: SSL certificate verification is disabled. Use with caution.'));
      axiosOptions.httpsAgent = new (require('https')).Agent({ rejectUnauthorized: false });
    }

    const response = await axios.get(source, axiosOptions);
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timed out. The server took too long to respond.');
    } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
      || error.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
      throw new Error(`SSL Certificate error: ${error.code}. Try using --insecure if you trust this source.`);
    } else if (error.response) {
      throw new Error(`Failed to fetch from URL: ${error.response.status} ${error.response.statusText}`);
    } else if (error.request) {
      throw new Error(`No response received from server. Check the URL and your network connection.`);
    } else {
      throw new Error(`Error fetching URL: ${error.message}`);
    }
  }
};

const readLocalFile = async (source) => {
  if (!await exists(source)) {
    throw new Error(`File does not exist: ${source}`);
  }
  return fs.readFileSync(source, 'utf8');
};

const readOpenApiFile = async (source, options = {}) => {
  let content;

  if (isUrl(source)) {
    content = await fetchSourceFromUrl(source, { insecure: options.insecure, label: 'specification' });

    // If response is already an object, return it directly
    if (typeof content === 'object' && content !== null) {
      return content;
    }
  } else {
    content = await readLocalFile(source);
  }

  // If content is a string, try to parse as JSON or YAML
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch (jsonError) {
      try {
        return jsyaml.load(content);
      } catch (yamlError) {
        throw new Error('Failed to parse content as JSON or YAML');
      }
    }
  }

  return content;
};

const readWSDLFile = async (source, options = {}) => {
  const content = isUrl(source)
    ? await fetchSourceFromUrl(source, { insecure: options.insecure, label: 'WSDL' })
    : await readLocalFile(source);

  // WSDL files are XML, so we return the content as a string
  if (typeof content === 'string') {
    return content;
  }

  throw new Error('WSDL content must be a string');
};

// Postman exports are JSON only; unlike OpenAPI there is no YAML fallback.
const readPostmanFile = async (source, options = {}) => {
  const content = isUrl(source)
    ? await fetchSourceFromUrl(source, { insecure: options.insecure, label: options.label || 'Postman collection' })
    : await readLocalFile(source);

  if (typeof content === 'object' && content !== null) {
    return content;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse Postman JSON from ${source}`);
  }
};

const resolveLocalWsdlSchemaRef = async (baseUri, ref) => {
  if (typeof baseUri !== 'string' || !baseUri.length) {
    throw new Error('Invalid base URI for schema resolution');
  }
  if (typeof ref !== 'string' || !ref.length) {
    throw new Error('Invalid schema reference');
  }

  const base = path.isAbsolute(baseUri) ? pathToFileURL(baseUri) : new URL(baseUri);
  const target = new URL(ref, base);

  if (target.protocol !== 'file:' || target.host !== base.host) {
    throw new Error(`Remote schema references are not supported (${ref})`);
  }

  const targetPath = fileURLToPath(target);
  if (!WSDL_SCHEMA_EXTENSIONS.includes(path.extname(targetPath).toLowerCase())) {
    throw new Error(`Schema references must point at a ${WSDL_SCHEMA_EXTENSIONS.join('/')} file (${ref})`);
  }

  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error(`Schema reference is not a file: ${targetPath}`);
  }
  if (stats.size > WSDL_MAX_SCHEMA_FILE_SIZE) {
    throw new Error(`Schema file exceeds the ${WSDL_MAX_SCHEMA_FILE_SIZE / (1024 * 1024)}MB limit: ${targetPath}`);
  }

  return {
    text: fs.readFileSync(targetPath, 'utf8'),
    uri: target.href,
    key: pathToFileURL(canonicalPath(targetPath)).href
  };
};

/**
 * Applies the same checks the app's environment importer does on top of the converter: a usable
 * name, and no two secrets sharing one.
 */
const convertPostmanEnvironment = async (source, { insecure } = {}) => {
  const postmanEnvironment = await readPostmanFile(source, { insecure, label: 'Postman environment' });
  const environment = postmanToBrunoEnvironment(postmanEnvironment);

  const name = coerceEnvName(environment.name);
  if (name === null) {
    throw new Error('Invalid environment: missing or invalid name');
  }

  return { name, variables: dedupeImportedSecrets(environment.variables) };
};

const TRANSLATION_WARNING_PREFIX = 'Error in postman translation:';

/**
 * The script translator warns with the full Babel error on every AST fallback, for the app's
 * devtools. The CLI receives those fallbacks as `translationIssues` and prints one line each, so
 * the raw stack is dropped here; every other warning still reaches stderr.
 */
const withTranslationWarningsSilenced = async (fn) => {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] !== TRANSLATION_WARNING_PREFIX) {
      originalWarn(...args);
    }
  };
  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
  }
};

/**
 * Reads and converts one Postman collection plus any environment exports that go with it. The
 * environments are attached to `collection.environments` so the collection writer emits them;
 * the converter's script-translation warnings are folded into `issues`.
 */
const importPostmanCollection = async (source, { insecure, preserveScripts, environmentSources = [] }) => {
  const postmanCollection = await readPostmanFile(source, { insecure });
  const { collection, issues, translationIssues } = await withTranslationWarningsSilenced(
    () => postmanToBruno(postmanCollection, { preserveScripts })
  );

  const environments = [];
  for (const environmentSource of environmentSources) {
    environments.push(await convertPostmanEnvironment(environmentSource, { insecure }));
  }
  collection.environments = environments;

  return { collection, issues: [...issues, ...translationIssues] };
};

/**
 * An existing directory gets a subdirectory named after the collection, which must be empty;
 * any other path is used as the collection directory itself and its parent must exist.
 */
const resolveCollectionOutputDir = async (output, collectionName) => {
  const resolvedOutput = path.resolve(output);

  if (await exists(resolvedOutput) && isDirectory(resolvedOutput)) {
    const outputDir = path.join(resolvedOutput, sanitizeName(collectionName));

    if (await exists(outputDir)) {
      if (fs.readdirSync(outputDir).length > 0) {
        throw new Error(`Output directory is not empty: ${outputDir}`);
      }
    } else {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    return outputDir;
  }

  const parentDir = path.dirname(resolvedOutput);
  if (!await exists(parentDir)) {
    throw new Error(`Parent directory does not exist: ${parentDir}`);
  }

  fs.mkdirSync(resolvedOutput, { recursive: true });
  return resolvedOutput;
};

const writeBrunoCollection = async (collection, { output, outputFile, collectionFormat }) => {
  if (outputFile) {
    const outputPath = path.resolve(outputFile);
    // packageReport is a console-only diagnostic the converter attaches outside the collection schema
    const serializable = { ...collection };
    delete serializable.packageReport;
    fs.writeFileSync(outputPath, JSON.stringify(serializable, null, 2));
    console.log(chalk.green(`Bruno collection saved as JSON to ${outputPath}`));
    return outputPath;
  }

  const outputDir = await resolveCollectionOutputDir(output, collection.name);
  await createCollectionFromBrunoObject(collection, outputDir, {
    format: collectionFormat === 'opencollection' ? 'yml' : 'bru'
  });
  console.log(chalk.green(`Bruno collection created at ${outputDir}`));
  return outputDir;
};

// Prints the summary, issues and package report; returns whether any issue was an error.
const reportImport = (collection, issues) => {
  console.log(formatImportSummary(collection));

  const issuesText = formatImportIssues(issues);
  if (issuesText) {
    console.log(issuesText);
  }

  const packageReportText = formatPackageReport(collection.packageReport);
  if (packageReportText) {
    console.log(packageReportText);
  }

  return hasImportErrors(issues);
};

// `output` is the collection directory or its `environments` directory; the collection must exist.
const resolveEnvironmentsDir = async (output) => {
  const resolvedOutput = path.resolve(output);
  const envDir = path.basename(resolvedOutput) === 'environments' ? resolvedOutput : path.join(resolvedOutput, 'environments');

  const collectionDir = path.dirname(envDir);
  if (!await exists(collectionDir)) {
    throw new Error(`Collection directory does not exist: ${collectionDir}`);
  }

  fs.mkdirSync(envDir, { recursive: true });
  return envDir;
};

const importPostmanEnvironmentFile = async ({ source, output, outputFile, collectionFormat, insecure }) => {
  if (outputFile) {
    throw new Error('--output-file is not supported for postman-env');
  }

  const environment = await convertPostmanEnvironment(source, { insecure });
  const envDir = await resolveEnvironmentsDir(output);
  const format = collectionFormat === 'opencollection' ? 'yml' : 'bru';
  const filePath = writeEnvironmentFile(environment, envDir, format, { overwrite: false });

  console.log(chalk.green(`Environment "${environment.name}" written to ${filePath}`));
};

const handler = async (argv) => {
  try {
    const { type, source, output, collectionFormat, outputFile, collectionName, insecure, groupBy, preserveScripts, environment } = argv;

    if (!type || !IMPORT_TYPES.includes(type)) {
      console.error(chalk.red(`Unsupported import type "${type}". Supported types: ${IMPORT_TYPES.join(', ')}`));
      process.exit(1);
    }

    if (!source) {
      console.error(chalk.red('Source file or URL is required'));
      process.exit(1);
    }

    if (!output && !outputFile) {
      console.error(chalk.red('Either --output or --output-file is required'));
      process.exit(1);
    }

    if (type === 'postman-env') {
      await importPostmanEnvironmentFile({ source, output, outputFile, collectionFormat, insecure });
      return;
    }

    let brunoCollection;
    let issues = [];

    if (type === 'openapi') {
      console.log(chalk.yellow(`Reading OpenAPI specification from ${source}...`));

      const openApiSpec = await readOpenApiFile(source, { insecure });

      if (!openApiSpec) {
        console.error(chalk.red('Failed to parse OpenAPI specification'));
        process.exit(1);
      }

      console.log(chalk.yellow('Converting OpenAPI specification to Bruno format...'));

      // Convert OpenAPI to Bruno format
      brunoCollection = openApiToBruno(openApiSpec, { groupBy });
    } else if (type === 'wsdl') {
      console.log(chalk.yellow(`Reading WSDL from ${source}...`));

      const wsdlContent = await readWSDLFile(source, { insecure });

      if (!wsdlContent) {
        console.error(chalk.red('Failed to read WSDL file'));
        process.exit(1);
      }

      console.log(chalk.yellow('Converting WSDL to Bruno format...'));

      // Convert WSDL to Bruno format
      const wsdlImportOptions = isUrl(source)
        ? {}
        : { uri: path.resolve(source), resolve: resolveLocalWsdlSchemaRef };
      brunoCollection = await wsdlToBruno(wsdlContent, wsdlImportOptions);
    } else if (type === 'postman') {
      console.log(chalk.yellow(`Reading Postman collection from ${source}...`));

      ({ collection: brunoCollection, issues } = await importPostmanCollection(source, {
        insecure,
        preserveScripts,
        environmentSources: environment || []
      }));
    }

    // Override collection name if provided
    if (collectionName) {
      brunoCollection.name = collectionName;
    }

    await writeBrunoCollection(brunoCollection, { output, outputFile, collectionFormat });

    // Error-severity issues are items the converter skipped; the collection is still written (app parity).
    if (type === 'postman' && reportImport(brunoCollection, issues)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
};

module.exports = {
  command,
  desc,
  builder,
  handler,
  IMPORT_TYPES,
  isUrl,
  fetchSourceFromUrl,
  readOpenApiFile,
  readWSDLFile,
  readPostmanFile,
  resolveLocalWsdlSchemaRef,
  convertPostmanEnvironment,
  importPostmanCollection,
  resolveCollectionOutputDir,
  writeBrunoCollection,
  reportImport
};
