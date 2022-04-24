import * as path from 'path';
import * as fs from 'fs-extra';
import type { ModuleInfo } from 'license-checker';
import { shell } from './_shell';
import type { Package } from './bundle';
import { Violation, ViolationType, ViolationsReport } from './violation';


const ATTRIBUTION_SEPARATOR = '\n----------------\n';

/**
 * Properties for `Attributions`.
 */
export interface AttributionsProps {
  /**
   * The package root directory.
   */
  readonly packageDir: string;
  /**
   * The name of the package.
   */
  readonly packageName: string;
  /**
   * Package dependencies.
   */
  readonly dependencies: Package[];
  /**
   * The parent directory underwhich all dependencies live.
   */
  readonly dependenciesRoot: string;
  /**
   * Path to the attribution licenses file to be created / validated.
   */
  readonly licensesPath: string;
  /**
   * List of allowed licenses.
   *
   */
  readonly allowedLicenses: string[];
  /**
   * Dependencies matching this pattern will be excluded from attribution.
   *
   * @default - no exclusions.
   */
  readonly exclude?: string;
  /**
   * Path to the attribution versions file to be created / validated.
   * If this property is set, dependency versions are left out of the
   * licenses document, and outputed into this file.
   *
   * @default - versions are encoded inside the licenses file.
   */
  readonly versionsPath?: string;
}

/**
 * `Attributions` represents attributions files containing third-party license information.
 */
export class Attributions {

  private readonly packageDir: string;
  private readonly packageName: string;
  private readonly dependencies: Package[];
  private readonly allowedLicenses: string[];
  private readonly dependenciesRoot: string;
  private readonly licensesPath: string;
  private readonly versionsPath?: string;

  private readonly attributions: Attribution[];
  private readonly licenses: string;
  private readonly versions: string;

  constructor(props: AttributionsProps) {
    this.packageDir = props.packageDir;
    this.packageName = props.packageName;
    this.licensesPath = path.join(this.packageDir, props.licensesPath);
    this.versionsPath = props.versionsPath ? path.join(this.packageDir, props.versionsPath) : undefined;
    this.dependencies = props.dependencies.filter(d => !props.exclude || !new RegExp(props.exclude).test(d.name));
    this.allowedLicenses = props.allowedLicenses.map(l => l.toLowerCase());
    this.dependenciesRoot = props.dependenciesRoot;

    // without the generated notice content, this object is pretty much
    // useless, so lets generate those of the bat.
    this.attributions = this.attribute();
    const { licenses, versions } = this.render(this.attributions);

    this.licenses = licenses;
    this.versions = versions;
  }

  /**
   * Validate the current notice file.
   *
   * This method never throws. The Caller is responsible for inspecting the report returned and act accordinagly.
   */
  public validate(): ViolationsReport {

    const violations: Violation[] = [];
    const relLicensesPath = path.relative(this.packageDir, this.licensesPath);
    const relVersionsPath = this.versionsPath ? path.relative(this.packageDir, this.versionsPath) : undefined;

    const fix = () => this.flush();

    const missingLicenses = !fs.existsSync(this.licensesPath);
    const missingVersions = this.versionsPath && !fs.existsSync(this.versionsPath);
    const licenses = missingLicenses ? undefined : fs.readFileSync(this.licensesPath, { encoding: 'utf-8' });
    const versions = (missingVersions || !this.versionsPath) ? undefined : fs.readFileSync(this.versionsPath, { encoding: 'utf-8' });
    const outdatedLicenses = licenses !== undefined && licenses !== this.licenses;
    const outdatedVersions = versions !== undefined && versions !== this.versions;

    if (missingLicenses) {
      violations.push({ type: ViolationType.MISSING_LICENSES, message: `${relLicensesPath} is missing`, fix });
    }

    if (outdatedLicenses) {
      violations.push({ type: ViolationType.OUTDATED_LICENSES, message: `${relLicensesPath} is outdated`, fix });
    }

    if (missingVersions) {
      violations.push({ type: ViolationType.MISSING_VERSIONS, message: `${relVersionsPath} is missing`, fix });
    }

    if (outdatedVersions) {
      violations.push({ type: ViolationType.OUTDATED_VERSIONS, message: `${relVersionsPath} is outdated`, fix });
    }

    const invalidLicense: Violation[] = Array.from(this.attributions.values())
      .filter(a => a.licenses.length === 1 && !this.allowedLicenses.includes(a.licenses[0].toLowerCase()))
      .map(a => ({ type: ViolationType.INVALID_LICENSE, message: `Dependency ${a.packageFqn} has an invalid license: ${a.licenses[0]}` }));

    const noLicense: Violation[] = Array.from(this.attributions.values())
      .filter(a => a.licenses.length === 0)
      .map(a => ({ type: ViolationType.NO_LICENSE, message: `Dependency ${a.packageFqn} has no license` }));

    const multiLicense: Violation[] = Array.from(this.attributions.values())
      .filter(a => a.licenses.length > 1)
      .map(a => ({ type: ViolationType.MULTIPLE_LICENSE, message: `Dependency ${a.packageFqn} has multiple licenses: ${a.licenses}` }));

    violations.push(...invalidLicense);
    violations.push(...noLicense);
    violations.push(...multiLicense);

    return new ViolationsReport(violations);
  }

  /**
   * Flush the generated attributions files to disk.
   */
  public flush() {
    fs.writeFileSync(this.licensesPath, this.licenses);
    if (this.versionsPath) {
      fs.writeFileSync(this.versionsPath, this.versions);
    }
  }

  private render(attributions: Attribution[]): { licenses: string; versions: string } {

    const content = [];

    if (attributions.length > 0) {
      content.push(`The ${this.packageName} package includes the following third-party software/licensing:`);
      content.push('');
    }

    // sort the attributions so the file doesn't change due to ordering issues
    const ordered = Array.from(attributions.values()).sort((a1, a2) => a1.packageFqn.localeCompare(a2.packageFqn));

    const versions: { [key: string]: string[] } = {};

    for (const attr of ordered) {
      const title = this.versionsPath ? attr.packageName : attr.packageFqn;
      content.push(`** ${title} - ${attr.url} | ${attr.licenses[0]}`);

      const versionsInUse = versions[attr.packageName] ?? [];
      versionsInUse.push(attr.packageVersion);
      versions[attr.packageName] = versionsInUse;

      // prefer notice over license
      if (attr.noticeText) {
        content.push(attr.noticeText);
      } else if (attr.licenseText) {
        content.push(attr.licenseText);
      }
      content.push(ATTRIBUTION_SEPARATOR);
    }

    return {
      licenses: content
      // since we are embedding external files, those can different line
      // endings, so we standardize to LF.
        .map(l => l.replace(/\r\n/g, '\n'))
        .join('\n'),
      versions: JSON.stringify(versions, null, 2),
    };

  }

  private attribute(): Attribution[] {

    if (this.dependencies.length === 0) {
      return [];
    }

    const attributions: Attribution[] = [];

    const pkg = (d: Package) => `${d.name}@${d.version}`;

    const packages = this.dependencies.map(d => pkg(d));

    function fetchInfos(_cwd: string, _packages: string[]) {
      // we don't use the programmatic API since it only offers an async API.
      // prefer to stay sync for now since its easier to integrate with other tooling.
      // will offer an async API further down the road.
      const command = `${require.resolve('license-checker/bin/license-checker')} --json --packages "${_packages.join(';')}"`;
      const output = shell(command, { cwd: _cwd, quiet: true });
      return JSON.parse(output);
    }

    // first run a global command to fetch as much information in one shot
    const infos = fetchInfos(this.dependenciesRoot, packages);

    for (const dep of this.dependencies) {
      const key = pkg(dep);

      // sometimes the dependency might not exist from fetching information globally,
      // so we try fetching a concrete package. this can happen for example when
      // two different major versions exist of the same dependency.
      const info: ModuleInfo = infos[key] ?? fetchInfos(dep.path, [pkg(dep)])[key];

      if (!info) {
        // make sure all dependencies are accounted for.
        throw new Error(`Unable to locate license information for ${key} (${dep.path})`);
      }

      const noticeText = info.noticeFile ? fs.readFileSync(info.noticeFile, { encoding: 'utf-8' }) : undefined;

      // for some reason, the license-checker package falls back to the README.md file of the package for license
      // text. this seems strange, disabling that for now.
      // see https://github.com/davglass/license-checker/blob/master/lib/license-files.js#L9
      // note that a non existing license file is ok as long as the license type could be extracted.
      const licenseFile = info.licenseFile?.toLowerCase().endsWith('.md') ? undefined : info.licenseFile;
      const licenseText = licenseFile ? fs.readFileSync(licenseFile, { encoding: 'utf-8' }) : undefined;

      // the licenses key comes in different types but we convert it here
      // to always be an array.
      const licenses = !info.licenses ? undefined : (Array.isArray(info.licenses) ? info.licenses : [info.licenses]);

      const baseUrl = `https://www.npmjs.com/package/${dep.name}`;
      const url = this.versionsPath ? baseUrl : `${baseUrl}/v/${dep.version}`;

      attributions.push({
        packageFqn: key,
        packageName: dep.name,
        packageVersion: dep.version,
        url,
        licenses: licenses ?? [],
        licenseText,
        noticeText,
      });
    }

    return attributions;
  }

}

/**
 * Attribution of a specific dependency.
 */
interface Attribution {
  /**
   * Attributed package fqn (name + version).
   */
  readonly packageFqn: string;
  /**
   * Attributed package name.
   */
  readonly packageName: string;
  /**
   * Attributed package version.
   */
  readonly packageVersion: string;
  /**
   * URL to the package.
   */
  readonly url: string;
  /**
   * Package licenses.
   *
   * Note that some packages will may have multiple licenses,
   * which is why this is an array. In such cases, the license
   * validation will fail since we currently disallow this.
   */
  readonly licenses: string[];
  /**
   * Package license content.
   *
   * In case a package has multiple licenses, this will
   * contain...one of them. It currently doesn't matter which
   * one since it will not pass validation anyway.
   */
  readonly licenseText?: string;
  /**
   * Package notice.
   */
  readonly noticeText?: string;
}
