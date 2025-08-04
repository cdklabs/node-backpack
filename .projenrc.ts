import { CdklabsTypeScriptProject } from 'cdklabs-projen-project-types';

const project = new CdklabsTypeScriptProject({
  setNodeEngineVersion: false,
  stability: 'stable',
  private: false,
  name: 'node-backpack',
  projenrcTs: true,
  defaultReleaseBranch: 'main',
  releaseToNpm: true,
  enablePRAutoMerge: true,
  devDeps: [
    '@types/madge',
    '@types/license-checker',
    '@types/fs-extra',
  ],
  deps: [
    'esbuild',
    'madge',
    'license-checker',
    'yargs',
    'fs-extra',
    'shlex',
  ],
  majorVersion: 1,
  bin: {
    'node-backpack': 'bin/node-backpack',
  },
});

project.addDevDeps(
  'jest-junit@^16',
  'prettier@^2.8',
);
project.npmignore?.addPatterns(
  // don't inlcude config files
  '.eslintrc.js',
  // As a rule we don't include .ts sources in the NPM package
  '*.ts',
  '!*.d.ts',
  'CONTRIBUTING.md',
);

project.gitignore.exclude('.vscode/');

// Too many console statements
project.eslint?.addRules({ 'no-console': ['off'] });

// required for esbuild > v0.14.32
// see https://github.com/evanw/esbuild/pull/2155
// see https://stackoverflow.com/questions/56906718/error-ts2304-cannot-find-name-webassembly
project.tsconfig?.compilerOptions?.lib?.push('dom');

// needed for CLI tests to run
project.testTask.prependSpawn(project.compileTask);

project.synth();
