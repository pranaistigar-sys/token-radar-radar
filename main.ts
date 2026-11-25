// Token launch radar entry (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every clean pre-token protocol with the
// model in lib/radar.ts, and writes the ranked board plus the dashboard's
// data and dossier:
//
//   /output/board.json      the ranked board (the gate reads this)
//   /output/data.js         the same board as a script the page loads
//   /output/dashboard/     the static page (index.html, app.css, app.js)
//   /output/screenshots/   the three screenshots of the page
//   /output/dossier.json   buildDossier's summary, written last
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// Grader run: node main.ts, reading /input/snapshot.json, writing /output.
// The program runs twice and must write identical bytes both times: every
// output here is a pure function of the snapshot bytes, with no clock,
// randomness or environment input.

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A --name <value> (or --name=<value>) argument, or its fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
const boardPath = join(out, 'board.json');
writeFileSync(boardPath, `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping dot-names, and
 *  return the names copied. Subdirectories are not copied: the dashboard
 *  and the screenshots are flat. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashFiles.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashFiles.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no .js file');

const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image(s): hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: bad image name`);
}

// Every output readable by every user: the scorer collects them as another
// user than the one this program runs as.
function makePublic(path: string): void {
  for (const name of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, name.name);
    if (name.isDirectory()) {
      chmodSync(p, 0o755);
      makePublic(p);
    } else if (name.isFile()) {
      chmodSync(p, 0o644);
    }
  }
}

// The dossier is written last: the scorer rebuilds it from this /output
// and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);
chmodSync(boardPath, 0o644);
makePublic(out);

const watchRows = board.filter((r) => r.on_watchlist).length;
const dossierBytes = statSync(join(out, 'dossier.json')).size;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows (${watchRows} watchlist, ${board.length - watchRows} below the floor)\n` +
    `token radar: wrote ${boardPath}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossierBytes} bytes)\n`,
);
