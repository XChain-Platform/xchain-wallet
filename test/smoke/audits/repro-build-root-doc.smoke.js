// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / G015: the project-wide reproducible-builds doc.
//
// The doc used to be four files: a root orientation doc plus one deep
// recipe per shell under `packages/*/REPRODUCIBLE_BUILDS.md`. 
// merged all four into one page in the sibling xchain-documentation
// checkout (components/wallet/reproducible-builds.md), with the per-shell
// recipes as sections of it, published at
// https://docs.xchain.io/components/wallet/reproducible-builds.
//
// So this pins two things that outlived the move: the page still carries a
// recipe per shell, and the `buildInfo` constants the About panel opens
// still point at that page, with the desktop one anchored at the section
// that actually exists. An anchor is exactly the kind of link that rots
// silently, because a wrong fragment still loads the page.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPath, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// The buildInfo half runs first: it is this repo's own source, so it holds
// whether or not the docs checkout is beside us.
//
// 1. Both constants are absolute URLs on the documentation site, since the
//    About panel renders them as links the user opens.
const buildInfoSrc = read('packages/core/src/buildInfo.js');

const constant = (name) => {
    const m = new RegExp(`export const ${name} = '([^']+)';`).exec(buildInfoSrc);
    assert.ok(m, `buildInfo exports ${name}`);
    return m[1];
};

const REPRO_BASE = 'https://docs.xchain.io/components/wallet/reproducible-builds';
const rootUrl = constant('REPRODUCIBLE_BUILD_DOC');
const desktopUrl = constant('REPRODUCIBLE_BUILD_DOC_DESKTOP');

assert.equal(rootUrl, REPRO_BASE,
    'REPRODUCIBLE_BUILD_DOC is the hosted reproducible-builds page, not a repo path');
assert.ok(desktopUrl.startsWith(`${REPRO_BASE}#`),
    `REPRODUCIBLE_BUILD_DOC_DESKTOP must anchor into the reproducible-builds page; got "${desktopUrl}"`);
for (const url of [rootUrl, desktopUrl]) {
    assert.doesNotThrow(() => new URL(url), `${url} parses as an absolute URL`);
}

// 2. The page itself: skip loudly without the sibling checkout.
skipUnlessDocs('repro-build-root-doc smoke');

const docPath = docsPath('reproducible-builds.md');
assert.ok(existsSync(docPath), `${docPath} exists`);
const docSrc = readFileSync(docPath, 'utf8');

// 3. Required headings. The orientation half has to stay skimmable: what
//    the property is, what it does and does not buy, and the shared floor
//    every shell builds on.
const requiredHeadings = [
    '# Reproducible Builds',
    '## What this protects against',
    '## What this does not protect against',
    '## Two halves of the property',
    '## Non-determinism sources addressed across every shell',
];
for (const heading of requiredHeadings) {
    assert.ok(docSrc.includes(heading), `repro doc has heading: ${heading}`);
}

assert.ok(/Level[- ]?2/i.test(docSrc),
    'doc states the Level-2 reproducibility goal');

// 4. Every shell keeps its own section and its own verification protocol.
//    The merge is where a shell's recipe could quietly vanish: one file is
//    easier to lose a section from than four files are to lose a file from.
const shellHeadings = new Map([
    ['desktop', '## Desktop (`@xchain-wallet/desktop`)'],
    ['extension', '## Extension (`@xchain-wallet/extension`)'],
    ['web', '## Web (`@xchain-wallet/web`)'],
]);
for (const [shell, heading] of shellHeadings) {
    const at = docSrc.indexOf(heading);
    assert.notEqual(at, -1, `repro doc has a section for the ${shell} shell: ${heading}`);
    const rest = docSrc.slice(at + heading.length);
    const end = rest.search(/\n## /);
    const section = end === -1 ? rest : rest.slice(0, end);
    assert.ok(section.includes('### Verification protocol'),
        `the ${shell} section carries its own verification protocol; without one the section is orientation, `
        + 'not a recipe a verifier can follow');
}

// 5. The desktop anchor resolves to a heading that is really on the page.
//    Slug rule copied from the docs site (punctuation is DELETED, runs of
//    whitespace collapse to one hyphen), so a fragment that no longer
//    matches any heading is caught here rather than by a user landing at
//    the top of a long page and assuming the section is gone.
const slugify = (s) => s.toLowerCase().trim().replace(/[^\w\- ]/g, '').replace(/\s+/g, '-');
const slugs = new Set(
    [...docSrc.matchAll(/^#{1,6} +(.+?)\s*$/gm)].map((m) => slugify(m[1])),
);
const anchor = desktopUrl.slice(desktopUrl.indexOf('#') + 1);
assert.ok(slugs.has(anchor),
    `REPRODUCIBLE_BUILD_DOC_DESKTOP anchors at "#${anchor}", which matches no heading in `
    + `${docPath}. The page still loads, so nothing else would notice; the user just lands at the top.`);
assert.equal(anchor, slugify(shellHeadings.get('desktop').replace(/^#+ +/, '')),
    'the desktop constant anchors at the desktop section specifically');

console.log('OK: reproducible-builds doc + buildInfo URL/anchor smoke '
    + `(${shellHeadings.size} shell recipes, desktop anchored at #${anchor})`);
