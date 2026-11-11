// Versiona la extensión: sube la versión, genera dist/ minificado y deja el zip en releases/.
//
// Uso:  node scripts/release.mjs [patch|minor|major|X.Y.Z]   (por defecto: patch)
//
// - manifest.json: sube la versión (la primera release es 1.0.1).
// - dist/: copia de lo que necesita la extensión (manifest, assets/, src/) con JS y CSS minificados
//   con esbuild (vía npx, sin instalar nada en el proyecto) y HTML sin comentarios ni espacios de más.
// - releases/<app>-v<versión>.zip: el contenido de dist/, listo para la Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESBUILD = 'esbuild@0.24.0';
const FIRST_VERSION = '1.0.1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const releases = join(root, 'releases');

// ---------- Versión ----------
function bump(current, how = 'patch') {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [maj, min, pat] = current.split('.').map(Number);
  if (maj < 1) return FIRST_VERSION; // antes de la primera release
  if (how === 'major') return `${maj + 1}.0.0`;
  if (how === 'minor') return `${maj}.${min + 1}.0`;
  if (how === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Tipo de versión desconocido: ${how} (usa patch, minor, major o X.Y.Z)`);
}

const manifestPath = join(root, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = bump(manifest.version, process.argv[2]);
const slug = manifest.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const zipPath = join(releases, `${slug}-v${version}.zip`);
if (existsSync(zipPath)) throw new Error(`Ya existe ${relative(root, zipPath)}: elige otra versión.`);

manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// ---------- dist/ ----------
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest));
cpSync(join(root, 'assets'), join(dist, 'assets'), { recursive: true });

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const sources = walk(join(root, 'src'));
const byExt = (ext) => sources.filter((f) => extname(f) === ext);

// JS y CSS: esbuild sin bundle (cada archivo queda en su lugar, los imports no cambian)
const minifiable = [...byExt('.js'), ...byExt('.css')].map((f) => relative(root, f));
execFileSync('npx', ['--yes', ESBUILD, ...minifiable, '--minify', '--target=chrome116',
  '--outbase=.', `--outdir=${relative(root, dist)}`, '--log-level=warning'], { cwd: root, stdio: 'inherit' });

// HTML: quitar comentarios y colapsar espacios (sin tocar el texto: un espacio sigue siendo un espacio)
for (const f of byExt('.html')) {
  const html = readFileSync(f, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const out = join(dist, relative(root, f));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

// Cualquier otro archivo de src/ (imágenes, json…) se copia tal cual
for (const f of sources.filter((f) => !['.js', '.css', '.html'].includes(extname(f)))) {
  cpSync(f, join(dist, relative(root, f)));
}

// ---------- releases/ ----------
mkdirSync(releases, { recursive: true });
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '.DS_Store', '*/.DS_Store'], { cwd: dist, stdio: 'inherit' });

const size = (p) => walk(p).reduce((n, f) => n + statSync(f).size, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`✓ ${manifest.name} v${version}`);
console.log(`  dist/      ${kb(size(dist))} (fuente: ${kb(size(join(root, 'src')) + size(join(root, 'assets')))})`);
console.log(`  ${relative(root, zipPath)}  ${kb(statSync(zipPath).size)}`);
