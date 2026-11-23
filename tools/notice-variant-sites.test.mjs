// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { findNoticeVariantSites } from './notice-variant-sites.mjs';

const scanner = fileURLToPath(new URL('./notice-variant-sites.mjs', import.meta.url));

test('finds notice props and a planted group entry key', () => {
    const hits = findNoticeVariantSites(`
        const view = <Notice variant="warning">Watch</Notice>;
        const status = <StatusMessage
            variant={kind}
        >State</StatusMessage>;
        const group = <StatusMessageGroup entries={[
            { key: 'safe', tone: 'info', children: 'Safe' },
            { key: 'planted', variant: 'warning', children: 'Watch' },
        ]} />;
    `, 'fixture.jsx');

    assert.deepEqual(hits.map(({ kind }) => kind), [
        'variant prop',
        'variant prop',
        'variant entry key',
    ]);
});

test('ignores unrelated variant keys and mapped notice props', () => {
    const hits = findNoticeVariantSites(`
        const presentation = { variant: 'warning' };
        const button = cloneElement(child, { variant: 'success' });
        const view = <Notice {...noticeToneProps(kind)}>Watch</Notice>;
        const group = <StatusMessageGroup entries={[
            { key: 'watch', tone: 'danger', caution: true, children: 'Watch' },
        ]} />;
    `);

    assert.deepEqual(hits, []);
});

test('command exits one and prints every rejected site', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'notice-variant-sites-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const fixture = join(root, 'fixture.jsx');
    writeFileSync(fixture, '<Notice variant="error">Failed</Notice>\n');

    const result = spawnSync(process.execPath, [scanner, fixture], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixture\.jsx:1:1: variant prop/);
});

test('command exits zero for a migrated file', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'notice-variant-sites-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const fixture = join(root, 'fixture.jsx');
    writeFileSync(fixture, '<Notice tone="danger" caution>Watch</Notice>\n');

    const result = spawnSync(process.execPath, [scanner, fixture], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
});
