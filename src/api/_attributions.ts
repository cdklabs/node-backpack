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
   * Path to the notice file to created / validated.
   */
  readonly filePath: string;
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
   * Encode package version information in the attribution file.
   *
   * @default false
   */
  readonly encodeVersions?: boolean;
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
  private readonly filePath: string;
  private readonly encodeVersions: boolean;

  private readonly attributions: Attribution[];
  private readonly content: string;
  private readonly versions: string;

  constructor(props: AttributionsProps) {
    this.packageDir = props.packageDir;
    this.packageName = props.packageName;
    this.filePath = path.join(this.packageDir, props.filePath);
    this.dependencies = props.dependencies.filter(d => !props.exclude || !new RegExp(props.exclude).test(d.name));
    this.allowedLicenses = props.allowedLicenses.map(l => l.toLowerCase());
    this.dependenciesRoot = props.dependenciesRoot;
    this.encodeVersions = props.encodeVersions ?? false;

    // without the generated notice content, this object is pretty much
    // useless, so lets generate those of the bat.
    this.attributions = this.attribute();
    const { licenses, versions } = this.render(this.attributions);

    this.content = licenses;
    this.versions = versions;
  }

  /**
   * Validate the current notice file.
   *
   * This method never throws. The Caller is responsible for inspecting the report returned and act accordinagly.
   */
  public validate(): ViolationsReport {

    const violations: Violation[] = [];
    const relNoticePath = path.relative(this.packageDir, this.filePath);

    const fix = () => this.flushAttributions();

    const missing = !fs.existsSync(this.filePath);
    const attributions = missing ? undefined : fs.readFileSync(this.filePath, { encoding: 'utf-8' });
    const outdated = attributions !== undefined && attributions !== this.content;

    if (missing) {
      violations.push({ type: ViolationType.MISSING_NOTICE, message: `${relNoticePath} is missing`, fix });
    }

    if (outdated) {
      violations.push({ type: ViolationType.OUTDATED_ATTRIBUTIONS, message: `${relNoticePath} is outdated`, fix });
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
   * Flush the generated attributions file to disk.
   */
  public flushAttributions() {
    fs.writeFileSync(this.filePath, this.content);
    if (!this.encodeVersions) {
      // in case the versions aren't encoded in the attribution file
      // lets write them to a separate file
      fs.writeFileSync(`${this.filePath}.versions.json`, this.versions);
    }
  }

  /**
   * Flush the generated versions file to disk.
   */
  public flushVersions(dir: string) {
    fs.writeFileSync(path.join(dir, `${path.basename(this.filePath)}.versions.json`), this.versions);
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
      const title = this.encodeVersions ? attr.packageFqn : attr.packageName;
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
      const url = this.encodeVersions ? `${baseUrl}/v/${dep.version}` : baseUrl;

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
