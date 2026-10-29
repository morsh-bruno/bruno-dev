const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const typescript = require('@rollup/plugin-typescript');
const terser = require('@rollup/plugin-terser').default;
const peerDepsExternal = require('rollup-plugin-peer-deps-external');
const { copy } = require('@web/rollup-plugin-copy');
const path = require('path');
const os = require('os');

const packageJson = require('./package.json');

const externalDeps = [
  '@usebruno/common',
  '@usebruno/common/utils',
  '@usebruno/filestore',
  '@usebruno/schema',
  '@usebruno/schema-types',
  /@usebruno\/schema-types\/.*/,
  '@opencollection/types',
  /@opencollection\/types\/.*/,
  // Runtime dependencies
  'lodash',
  'lodash/each',
  'lodash/get',
  'lodash/cloneDeep',
  'lodash/map',
  'js-yaml',
  'jscodeshift',
  'mime-types',
  'nanoid',
  'xml2js',
  // Node built-ins
  'path',
  'fs',
  'node:path',
  'node:fs'
];

// One config per entry and format, so rollup never shares a chunk between the main entry
// (loaded by the renderer) and the fs-based io entry.
const createBuildConfig = ({ input, outputDir, format, extraPlugins = [] }) => ({
  input,
  output: {
    dir: outputDir,
    format,
    sourcemap: true,
    exports: 'named',
    entryFileNames: 'index.js'
  },
  plugins: [
    peerDepsExternal(),
    nodeResolve({
      extensions: ['.js', '.ts', '.tsx', '.json']
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: true,
      outDir: outputDir
    }),
    terser({
      maxWorkers: Math.max(1, os.availableParallelism())
    }),
    ...extraPlugins
  ],
  external: externalDeps
});

const copyWorkerScripts = () => copy({
  patterns: 'src/workers/scripts/**/*',
  rootDir: '.'
});

module.exports = [
  createBuildConfig({
    input: 'src/index.js',
    outputDir: path.dirname(packageJson.main),
    format: 'cjs',
    extraPlugins: [copyWorkerScripts()]
  }),
  createBuildConfig({
    input: 'src/index.js',
    outputDir: path.dirname(packageJson.module),
    format: 'esm',
    extraPlugins: [copyWorkerScripts()]
  }),
  createBuildConfig({
    input: 'src/io/index.ts',
    outputDir: 'dist/io/cjs',
    format: 'cjs'
  }),
  createBuildConfig({
    input: 'src/io/index.ts',
    outputDir: 'dist/io/esm',
    format: 'esm'
  })
];
