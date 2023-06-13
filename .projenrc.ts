import { typescript } from 'projen';
const project = new typescript.TypeScriptProject({
  name: 'node-backpack',
  projenrcTs: true,
  defaultReleaseBranch: 'main',
  releaseToNpm: true,
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
  bin: {
    'node-backpack': 'bin/node-backpack',
  },
  autoApproveOptions: {
    allowedUsernames: ['cdklabs-automation'],
    secret: 'GITHUB_TOKEN',
  },
  autoApproveUpgrades: true,
});

project.gitignore.exclude('.vscode/');

// required for esbuild > v0.14.32
// see https://github.com/evanw/esbuild/pull/2155
// see https://stackoverflow.com/questions/56906718/error-ts2304-cannot-find-name-webassembly
project.tsconfig?.compilerOptions.lib?.push('dom');

// needed for CLI tests to run
project.testTask.prependSpawn(project.compileTask);

project.synth();
