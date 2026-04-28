// Smoke for §55 / G178 — `MAINTAINERS.md`.
//
// A conventional MAINTAINERS file at the repo root: lists the
// people responsible, what each owns, escalation paths, and how new
// maintainers join. Keep the structure stable so downstream packagers
// (distros, the OWNERS-file ecosystem) can scrape it.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const docPath = 'MAINTAINERS.md';
assert.ok(existsSync(join(root, docPath)), `${docPath} exists at repo root`);

const docSrc = read(docPath);

// Required structural headings.
const requiredHeadings = [
    '# Maintainers',
    '## Primary maintainer',
    '## Areas of responsibility',
    '## Adding a maintainer',
    '## Removing a maintainer',
    '## Escalation paths',
    '## Decision-making',
    '## Cross-project relationships',
];
for (const heading of requiredHeadings) {
    assert.ok(docSrc.includes(heading),
        `MAINTAINERS.md has heading: ${heading}`);
}

// Lead is named with a real GitHub handle (link must be a real-looking
// URL — not a placeholder).
assert.ok(/J-Dog/.test(docSrc), 'lead maintainer named');
assert.ok(/https:\/\/github\.com\/J-Dog/.test(docSrc),
    'lead maintainer links to a real GitHub profile URL');

// Areas table covers the canonical wallet sub-systems so a future
// contributor knows the partition.
const requiredAreas = [
    'Core flows',
    'Schemas',
    'Signers',
    'Bridge',
    'Extension shell',
    'Web shell',
    'Desktop shell',
    'Documentation',
    'Release engineering',
    'Smokes + tests',
];
for (const area of requiredAreas) {
    assert.ok(new RegExp(`\\| ${area.replace('+', '\\+')} \\|`).test(docSrc),
        `Areas of responsibility table covers: ${area}`);
}

// Escalation table names every required channel — these have to match
// the channels published in SECURITY.md / CODE_OF_CONDUCT.md so a
// reader can cross-reference.
for (const channel of ['security@dankest.llc', 'conduct@dankest.llc']) {
    assert.ok(docSrc.includes(channel),
        `escalation table includes channel: ${channel}`);
}

// Cross-project section names sibling projects so readers know the
// blast radius of a maintainer's authority.
for (const proj of ['xchain-sdk', 'xchain-platform', 'xchain-documentation']) {
    assert.ok(docSrc.includes(proj),
        `cross-project section names: ${proj}`);
}

// Honest framing: pre-launch single-maintainer reality, not aspirational.
assert.ok(/single primary maintainer/i.test(docSrc) || /pre-launch/i.test(docSrc),
    'doc honestly frames the pre-launch single-maintainer state');

// Companion docs cited so readers can navigate.
for (const companion of ['CODE_OF_CONDUCT.md', 'SECURITY.md', 'CONTRIBUTING.md']) {
    assert.ok(docSrc.includes(companion),
        `MAINTAINERS.md cites ${companion}`);
    assert.ok(existsSync(join(root, companion)),
        `cited companion exists: ${companion}`);
}

console.log('OK — MAINTAINERS.md doc smoke');
