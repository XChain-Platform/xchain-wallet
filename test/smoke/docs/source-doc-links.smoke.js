// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCS_ROOT, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = resolve(here, '..', '..', '..');
const docsOrigin = 'https://docs.xchain.io';
const docsUrl = /https:\/\/docs\.xchain\.io(?:\/[A-Za-z0-9._~!$&*+,;=:@%/-]*)?(?:#[A-Za-z0-9._~!$&*+,;=:@%/?-]*)?/g;

const trackedSources = execFileSync(
    'git',
    ['-C', walletRoot, 'ls-files', '-z', '--', 'packages/core/src/shared', ':(glob)packages/*/src/**'],
    { encoding: 'utf8' },
).split('\0').filter(Boolean);

const links = [];
for (const file of trackedSources) {
    const source = readFileSync(join(walletRoot, file), 'utf8');
    for (const match of source.matchAll(docsUrl)) {
        links.push({ file, url: match[0] });
    }
}

assert.ok(links.length > 0, 'the source inventory finds at least one docs.xchain.io link');
skipUnlessDocs('source docs links smoke');

function candidatesFor(url) {
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
    if (!pathname) return [join(DOCS_ROOT, 'README.md')];
    if (extname(pathname)) return [join(DOCS_ROOT, pathname)];
    return [join(DOCS_ROOT, `${pathname}.md`), join(DOCS_ROOT, pathname, 'README.md')];
}

function headingSlug(heading) {
    return heading.toLowerCase().trim().replace(/[^\w\- ]/g, '').replace(/\s+/g, '-');
}

for (const link of links) {
    const parsed = new URL(link.url);
    assert.equal(parsed.origin, docsOrigin, `${link.file}: docs link stays on ${docsOrigin}`);

    const candidates = candidatesFor(parsed);
    const docPath = candidates.find((candidate) => existsSync(candidate));
    assert.ok(
        docPath,
        `${link.file}: ${link.url} resolves to ${candidates.map((candidate) => relative(DOCS_ROOT, candidate)).join(' or ')}`,
    );

    if (parsed.hash) {
        const headings = [...readFileSync(docPath, 'utf8').matchAll(/^#{1,6} +(.+?)\s*$/gm)];
        const slugs = new Set(headings.map((match) => headingSlug(match[1])));
        const fragment = decodeURIComponent(parsed.hash.slice(1));
        assert.ok(slugs.has(fragment), `${link.file}: ${link.url} names an existing heading`);
    }
}

const uniqueLinks = new Set(links.map(({ url }) => url));

const docsLinkSurfaces = [
    ['packages/core/src/shared/components/LearnNote.jsx', /<a\b[^>]*href=\{DOCS_URL\}[^>]*>/],
    ['packages/core/src/shared/components/BottomTabBar.jsx', /<a\b[^>]*href=\{site\.href\}[^>]*>/],
    ['packages/core/src/shared/components/PlatformSwitcher.jsx', /<a\b[^>]*href=\{p\.href\}[^>]*>/],
    ['packages/core/src/shared/components/settings/AboutSection.jsx', /<a\b[^>]*href=\{href\}[^>]*>/],
];

for (const [file, anchorPattern] of docsLinkSurfaces) {
    const source = readFileSync(join(walletRoot, file), 'utf8');
    const anchor = source.match(anchorPattern)?.[0];
    assert.ok(anchor, `${file}: docs link renders as an anchor`);
    assert.match(anchor, /\btarget="_blank"/, `${file}: docs link opens outside the app`);
    const rel = anchor.match(/\brel="([^"]+)"/)?.[1].split(/\s+/) || [];
    assert.ok(rel.includes('noopener'), `${file}: docs link prevents opener access`);
    assert.ok(rel.includes('noreferrer'), `${file}: docs link omits referrer data`);
}

for (const { file, url } of links) {
    console.log(`${file}: ${url}`);
}
console.log(`OK: ${links.length} source docs links (${uniqueLinks.size} unique) resolve in ${DOCS_ROOT}`);
