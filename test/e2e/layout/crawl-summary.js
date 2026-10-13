// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Merge a click crawl's shard files into findings.json and a readable
// summary.md, grouping repeats of one symptom so a fault that fires on every
// screen reads as one line with a count rather than a hundred.
//
//     node test/e2e/layout/crawl-summary.js tmp/click-crawl/android-lg-k51

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
    console.error('usage: node crawl-summary.js <crawl output dir>');
    process.exit(2);
}

const read = (prefix) => readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

const findings = read('findings-shard-');
const covered = read('covered-shard-');
writeFileSync(join(dir, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`);

// One group per symptom and normalised error text: numbers, hashes and
// addresses vary between screens without making it a different fault.
const norm = (t) => String(t || '').replace(/[0-9a-f]{16,}/gi, '#').replace(/\d+/g, 'N').slice(0, 160);
const groups = new Map();
for (const f of findings) {
    const key = `${f.symptom}|${norm(f.error)}`;
    if (!groups.has(key)) groups.set(key, { symptom: f.symptom, error: f.error || '', where: [] });
    groups.get(key).where.push(`${f.screen} > ${f.control}`);
}

const screens = covered.filter((c) => c.control === '(screen)');
const presses = covered.filter((c) => c.control !== '(screen)' && /^(changed|no change)$/.test(c.result)).length;
const forms = covered.filter((c) => /^form /.test(c.control));
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const lines = [
    `# Click crawl: ${dir.split('/').pop()}`,
    '',
    `${screens.length} screens, ${presses} presses, ${forms.length} form submissions, ${findings.length} findings in ${groups.size} groups.`,
    '',
    '| Symptom | Error | Count | Where (first three) |',
    '|---|---|---|---|',
    ...[...groups.values()]
        .sort((a, b) => b.where.length - a.where.length)
        .map((g) => `| ${cell(g.symptom)} | ${cell(g.error.slice(0, 140))} | ${g.where.length} | ${cell(g.where.slice(0, 3).join('; '))} |`),
    '',
    '## Form outcomes',
    '',
    '| Screen | Form | Result |',
    '|---|---|---|',
    ...forms.map((c) => `| ${cell(c.screen)} | ${cell(c.control)} | ${cell(c.result.slice(0, 160))} |`),
    '',
];
writeFileSync(join(dir, 'summary.md'), lines.join('\n'));
console.log(lines.slice(0, 3).join('\n'));
