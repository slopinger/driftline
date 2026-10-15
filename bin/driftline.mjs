#!/usr/bin/env node
import {readFile, readdir, lstat} from 'node:fs/promises';
import {resolve, relative, extname, basename} from 'node:path';
import {parseSpec, compareSpecs, attachSources, markdown} from '../web/engine.mjs';
const args = process.argv.slice(2);
const usage = 'Usage: driftline BEFORE.json AFTER.json [--source DIR] [--format json|markdown] [--fail-on breaking|review|never]\nExit: 0 pass, 1 policy threshold/incomplete analysis, 2 input error. Defaults: markdown, breaking.';
try {
  if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }
  if (args.length < 2 || args[0].startsWith('--') || args[1].startsWith('--')) throw new Error(usage);
  const [oldFile, newFile] = args;
  const options = {format: 'markdown', 'fail-on': 'breaking'};
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !['source', 'format', 'fail-on'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage);
    options[key] = args[i + 1];
  }
  if (!['json', 'markdown'].includes(options.format) || !['breaking', 'review', 'never'].includes(options['fail-on'])) throw new Error(usage);
  async function readSpec(file) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error(`${file}: expected regular JSON file <=5 MiB (no symlinks).`);
    return parseSpec(await readFile(file, 'utf8'), file);
  }
  const [before, after] = await Promise.all([readSpec(oldFile), readSpec(newFile)]);
  let report = compareSpecs(before, after);
  if (options.source) {
    const root = resolve(options.source); const files = []; let bytes = 0;
    const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.sh']);
    const skipped = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.venv', '__pycache__', '.next']);
    const exclude = new Set([resolve(oldFile), resolve(newFile)]);
    if (!(await lstat(root)).isDirectory()) throw new Error('Source must be a directory, not a symlink.');
    let entries = 0;
    async function walk(dir) {
      for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++entries > 50000) throw new Error('Source traversal limit: 50,000 entries. Choose a smaller directory.');
        if (entry.isSymbolicLink() || skipped.has(entry.name) || entry.name.startsWith('.')) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && extensions.has(extname(entry.name)) && !exclude.has(path)) {
          const st = await lstat(path);
          if (!st.isFile() || st.size > 1024 * 1024) throw new Error(`Source ${relative(root, path)} exceeds 1 MiB. Choose a smaller directory.`);
          bytes += st.size;
          if (files.length >= 1000 || bytes > 10 * 1024 * 1024) throw new Error('Source limit: 1,000 files / 10 MiB. Choose a smaller directory.');
          const text = await readFile(path, 'utf8');
          if (!text.includes('\0')) files.push({name: relative(root, path), text});
        }
      }
    }
    await walk(root); report = attachSources(report, files);
  }
  console.log(options.format === 'json' ? JSON.stringify(report, null, 2) : markdown(report));
  const threshold = options['fail-on'];
  process.exitCode = threshold !== 'never' && (report.incomplete || report.counts.breaking > 0 || (threshold === 'review' && report.counts.review > 0)) ? 1 : 0;
} catch (error) { console.error(`driftline: ${error.message}`); process.exitCode = 2; }
