import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { Bundle } from '../../src';
import { shell } from '../../src/api/_shell';
import { Package } from '../_package';

test('validate', () => {

  const pkg = Package.create({ name: 'consumer', licenses: ['Apache-2.0'], circular: true, notice: 'outdated' });
  const dep1 = pkg.addDependency({ name: 'dep1', licenses: ['INVALID'] });
  const dep2 = pkg.addDependency({ name: 'dep2', licenses: ['Apache-2.0', 'MIT'] });

  pkg.write();
  pkg.install();

  const bundle = new Bundle({
    packageDir: pkg.dir,
    entryPoints: [pkg.entrypoint],
    resources: { missing: 'bin/missing' },
    allowedLicenses: ['Apache-2.0'],
  });
  const actual = new Set(bundle.validate().violations.map(v => `${v.type}: ${v.message}`));
  const expected = new Set([
    'circular-import: lib/bar.js -> lib/foo.js',
    'missing-resource: Unable to find resource (missing) relative to the package directory',
    'outdated-attributions: THIRD_PARTY_LICENSES is outdated',
    `invalid-license: Dependency ${dep1.name}@${dep2.version} has an invalid license: UNKNOWN`,
    `multiple-license: Dependency ${dep2.name}@${dep2.version} has multiple licenses: Apache-2.0,MIT`,
  ]);

  expect(actual).toEqual(expected);
});

test('write', () => {

  const pkg = Package.create({ name: 'consumer', licenses: ['Apache-2.0'] });
  pkg.addDependency({ name: 'dep1', licenses: ['MIT'] });
  pkg.addDependency({ name: 'dep2', licenses: ['Apache-2.0'] });

  pkg.write();
  pkg.install();

  const bundle = new Bundle({
    packageDir: pkg.dir,
    entryPoints: [pkg.entrypoint],
    allowedLicenses: ['Apache-2.0', 'MIT'],
    // makes the bundle snapshot determenistic
    sourcemap: false,
  });

  const bundleDir = bundle.write();

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

  const bundle = new Bundle({
    packageDir: pkg.dir,
    entryPoints: [pkg.entrypoint],
    allowedLicenses: ['Apache-2.0', 'MIT'],
  });

  // we need to first fix all violations
  // before we can pack
  bundle.validate({ fix: true });

  bundle.pack();

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

  const bundle = new Bundle({
    packageDir: pkg.dir,
    entryPoints: [pkg.entrypoint],
    allowedLicenses: ['Apache-2.0', 'MIT'],
    encodeVersions: true,
  });

  // we need to first fix all violations
  // before we can pack
  bundle.validate({ fix: true });

  bundle.pack();

  const tarball = path.join(pkg.dir, `${pkg.name}-${pkg.version}.tgz`);

  const workdir = fs.mkdtempSync(os.tmpdir());
  shell(`npm install ${tarball}`, { cwd: workdir });

  const installed = path.join(workdir, 'node_modules', pkg.name);
  const attributions = fs.readFileSync(path.join(installed, 'THIRD_PARTY_LICENSES'), { encoding: 'utf-8' });

  expect(fs.existsSync(path.join(installed, 'THIRD_PARTY_LICENSES.versions.json'))).toBeFalsy();
  expect(attributions).toMatchSnapshot();

});

test('write ignores only .git and node_modules directories', () => {

  const pkg = Package.create({ name: 'consumer', licenses: ['Apache-2.0'] });
  pkg.addDependency({ name: 'dep1', licenses: ['MIT'] });
  pkg.addDependency({ name: 'dep2', licenses: ['Apache-2.0'] });

  pkg.write();
  pkg.install();

  const bundle = new Bundle({
    packageDir: pkg.dir,
    entryPoints: [pkg.entrypoint],
    allowedLicenses: ['Apache-2.0', 'MIT'],
  });

  // add a gitignore file to the package - it should be included
  fs.writeFileSync(path.join(pkg.dir, '.gitignore'), 'something');

  // add a silly node_modules_file to the package - it should be included
  fs.writeFileSync(path.join(pkg.dir, 'node_modules_file'), 'something');

  const bundleDir = bundle.write();

  expect(fs.existsSync(path.join(bundleDir, '.gitignore'))).toBeTruthy();
  expect(fs.existsSync(path.join(bundleDir, 'node_modules_file'))).toBeTruthy();

});
