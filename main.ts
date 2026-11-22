// token-radar-01 entry: snapshot in, ranked board, dashboard data and dossier out.
//
// Reads --input <file|directory> (default /input), scores the snapshot with lib/model.ts, writes
// board.json and data.js, copies dashboard/ and screenshots/ into the output, then writes
// dossier.json with the vendored make.fun library. Node 22, standard library only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps: the text cap shapes the dossier, the other two only refuse. */
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((value) => value.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const snapshotFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  process.stderr.write(`token radar: no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outputDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
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

copyFiles(join(here, 'dashboard'), join(outputDir, 'dashboard'));
const screenshots = copyFiles(join(here, 'screenshots'), join(outputDir, 'screenshots'));
if (screenshots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${screenshots.length} image${screenshots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}

writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, DOSSIER_CAPS));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} board rows\n`,
);
