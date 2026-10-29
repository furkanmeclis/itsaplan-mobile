import { readFile, readdir, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? 'dist/licenses');
const inside = (parent, path) => { const part = relative(parent, path); return part !== '..' && !part.startsWith('..' + sep) && !part.startsWith(sep); };
const report = { formatVersion: 1, projectLicense: 'AGPL-3.0-only',
  scope: 'npm lockfile and installed-package metadata, including build dependencies; not a binary SBOM or native license approval',
  packages: [], warnings: [] };
const notices = ['THIRD-PARTY NPM LICENSE TEXTS', report.scope,
  'Original notices below retain their own licenses. This aggregation does not relicense dependencies.'];
for (const [scope, subdir] of [['mobile', '.'], ['push', 'services/push']]) {
  const base = resolve(root, subdir);
  const lock = JSON.parse(await readFile(resolve(base, 'package-lock.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(base, 'package.json'), 'utf8'));
  const seen = new Set();
  for (const [path, info] of Object.entries(lock.packages ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (!path.startsWith('node_modules/') || info.link) continue;
    const name = info.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const key = `${name}@${info.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pkg = { scope, name, version: info.version, license: info.license ?? 'UNKNOWN',
      development: info.dev === true, direct: Object.hasOwn(manifest.dependencies ?? {}, name), noticeFiles: [] };
    report.packages.push(pkg);
    if (pkg.license === 'UNKNOWN') report.warnings.push({ scope, name, version: info.version, reason: 'missing-license-metadata' });
    const dir = resolve(base, path);
    if (!inside(resolve(base, 'node_modules'), dir)) throw new Error('Package path escapes node_modules');
    let actual;
    try { actual = await realpath(dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; report.warnings.push({ scope, name, version: info.version, reason: 'package-not-installed-on-this-platform' }); continue; }
    if (!inside(resolve(base, 'node_modules'), actual)) throw new Error('Package symlink escapes node_modules');
    for (const filename of (await readdir(dir)).sort()) {
      if (!/^(licen[cs]e|copying|notice|unlicense)(?:$|[.\-_])/i.test(filename)) continue;
      const file = resolve(dir, filename);
      if (!inside(actual, await realpath(file))) throw new Error('Notice symlink escapes its package');
      const details = await stat(file);
      if (!details.isFile()) continue;
      if (details.size > 1024 * 1024) { report.warnings.push({ scope, name, version: info.version, reason: 'notice-exceeds-one-mib', filename }); continue; }
      const text = await readFile(file, 'utf8');
      pkg.noticeFiles.push(filename);
      notices.push(`\n${'='.repeat(72)}\n${scope}: ${name}@${info.version}\n${filename}\nDeclared license: ${pkg.license}\n\n${text}`);
    }
    if (!pkg.noticeFiles.length) report.warnings.push({ scope, name, version: info.version, reason: 'no-top-level-notice-file' });
  }
}
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'npm-license-inventory.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(resolve(output, 'NPM-NOTICES.txt'), notices.join('\n') + '\n');
await writeFile(resolve(output, 'PROJECT-LICENSE.txt'), await readFile(resolve(root, 'LICENSE')));
console.log(JSON.stringify({ packages: report.packages.length, noticeFiles: report.packages.reduce((n, p) => n + p.noticeFiles.length, 0), warnings: report.warnings.length }));
