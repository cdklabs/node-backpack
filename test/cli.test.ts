import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { shell } from '../src/api/_shell';
import { Package } from './_package';

test('validate', () => {

  const pkg = Package.create({ name: 'consumer', licenses: ['Apache-2.0'], circular: true, notice: 'outdated' });
  const dep1 = pkg.addDependency({ name: 'dep1', licenses: ['INVALID'] });
  const dep2 = pkg.addDependency({ name: 'dep2', licenses: ['Apache-2.0', 'MIT'] });

  pkg.write();
  pkg.install();

  try {
    const command = [
      whereami(),
      '--entrypoint', pkg.entrypoint,
      '--resource', 'missing:bin/missing',
      '--license', 'Apache-2.0',
      'validate',
    ].join(' ');
    shell(command, { cwd: pkg.dir, quiet: true });
  } catch (e: any) {
    const violations = new Set(e.stderr.toString().trim().split('\n').filter((l: string) => l.startsWith('-')));
    const expected = new Set([
      `- invalid-license: Dependency ${dep1.name}@${dep1.version} has an invalid license: UNKNOWN`,
      `- multiple-license: Dependency ${dep2.name}@${dep2.version} has multiple licenses: Apache-2.0,MIT`,
      '- outdated-attributions: THIRD_PARTY_LICENSES is outdated (fixable)',
      '- missing-resource: Unable to find resource (missing) relative to the package directory',
      '- circular-import: lib/bar.js -> lib/foo.js',
    ]);
    expect(violations).toEqual(expected);
  }

});

test('write', () => {

  const pkg = Package.create({ name: 'consumer', licenses: ['Apache-2.0'] });
  pkg.addDependency({ name: 'dep1', licenses: ['MIT'] });
  pkg.addDependency({ name: 'dep2', licenses: ['Apache-2.0'] });

  pkg.write();
  pkg.install();

  const command = [
    whereami(),
    '--entrypoint', pkg.entrypoint,
    '--license', 'Apache-2.0',
    '--license', 'MIT',
    'write',
  ].join(' ');
  const bundleDir = shell(command, { cwd: pkg.dir, quiet: true });

  expect(fs.existsSync(path.join(bundleDir, pkg.entrypoint))).toBeTruthy();
  expect(fs.existsSync(path.join(bundleDir, 'package.json'))).toBeTruthy();
  expect(fs.existsSync(path.join(bundleDir, 'lib', 'foo.js'))).toBeTruthy();
  expect(fs.existsSync(path.join(bundleDir, 'lib', 'bar.js'))).toBeTruthy();
  expect(fs.existsSync(path.join(bundleDir, 'node_modules'))).toBeFalsy();
  expect(fs.existsSync(path.join(bundleDir, '.git'))).toBeFalsy();

  const manifest = fs.readJSONSync(path.join(bundleDir, 'package.json'));
  const entrypoint = fs.readFileSync(path.join(bundleDir, pkg.entrypoint), { encoding: 'utf-8' });

  expect(entrypoint).toMatchSnapshot();
  expect(Object.keys(manifest.devDependencies)).toEqual(['dep1', 'dep2']);
  expect(manifest.dependencies).toEqual({});

});

test('pack', () => {

  const pkg = Package.create({ name: 'consumer', licenses: ['Apache-2.0'] });
  pkg.addDependency({ name: 'dep1', licenses: ['MIT'] });
  pkg.addDependency({ name: 'dep2', licenses: ['Apache-2.0'] });

  pkg.write();
  pkg.install();

  // we need to first fix all violations
  // before we can pack
  const fix = [
    whereami(),
    '--entrypoint', pkg.entrypoint,
    '--license', 'Apache-2.0',
    '--license', 'MIT',
    'validate --fix',
  ].join(' ');
  shell(fix, { cwd: pkg.dir, quiet: true });

  const pack = [
    whereami(),
    '--entrypoint', pkg.entrypoint,
    '--license', 'Apache-2.0',
    '--license', 'MIT',
    'pack',
  ].join(' ');
  shell(pack, { cwd: pkg.dir, quiet: true });

  const tarball = path.join(pkg.dir, `${pkg.name}-${pkg.version}.tgz`);

  const workdir = fs.mkdtempSync(os.tmpdir());
  shell(`npm install ${tarball}`, { cwd: workdir });

  const installed = path.join(workdir, 'node_modules', pkg.name);
  const attributions = fs.readFileSync(path.join(installed, 'THIRD_PARTY_LICENSES'), { encoding: 'utf-8' });
  const versions = fs.readFileSync(path.join(installed, 'THIRD_PARTY_LICENSES.versions.json'), { encoding: 'utf-8' });

  expect(attributions).toMatchSnapshot();
  expect(versions).toMatchSnapshot();

});

test('pack with versions encoded in attributions', () => {

  const pkg = Package.create({ name: 'consumer', licenses: ['Apache-2.0'] });
  pkg.addDependency({ name: 'dep1', licenses: ['MIT'] });
  pkg.addDependency({ name: 'dep2', licenses: ['Apache-2.0'] });

  pkg.write();
  pkg.install();

  // we need to first fix all violations
  // before we can pack
  const fix = [
    whereami(),
    '--entrypoint', pkg.entrypoint,
    '--encode-versions',
    '--license', 'Apache-2.0',
    '--license', 'MIT',
    'validate --fix',
  ].join(' ');
  shell(fix, { cwd: pkg.dir, quiet: true });

  const pack = [
    whereami(),
    '--entrypoint', pkg.entrypoint,
    '--encode-versions',
    '--license', 'Apache-2.0',
    '--license', 'MIT',
    'pack',
  ].join(' ');
  shell(pack, { cwd: pkg.dir, quiet: true });

  const tarball = path.join(pkg.dir, `${pkg.name}-${pkg.version}.tgz`);

  const workdir = fs.mkdtempSync(os.tmpdir());
  shell(`npm install ${tarball}`, { cwd: workdir });

  const installed = path.join(workdir, 'node_modules', pkg.name);
  const attributions = fs.readFileSync(path.join(installed, 'THIRD_PARTY_LICENSES'), { encoding: 'utf-8' });

  expect(fs.existsSync(path.join(installed, 'THIRD_PARTY_LICENSES.versions.json'))).toBeFalsy();
  expect(attributions).toMatchSnapshot();

});

function whereami() {
  return path.join(path.join(__dirname, '..', 'bin', 'node-backpack'));
}