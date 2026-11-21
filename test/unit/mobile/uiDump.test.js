// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
    findNode,
    firstMissingLine,
    parseUiDump,
    tapPoint,
} from '../../../packages/mobile/scripts/ui-dump.js';

const SCRIPT = resolve(process.cwd(), 'packages/mobile/scripts/ui-dump.js');
const DUMP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hierarchy rotation="0">
  <node text="Wallet &amp; Vault &#65; &#x1F511;"
    resource-id="io.xchain:id/title"
    content-desc="Open &lt;wallet&gt; &quot;now&quot; &apos;please&apos;"
    package="io.xchain.wallet" bounds="[10,20][111,221]" />
  <node text="Recovery phrase" resource-id="io.xchain:id/recovery"
    content-desc="Protect recovery phrase"
    package="io.xchain.wallet" bounds="[100,200][200,300]" />
</hierarchy>`;
const nodes = parseUiDump(DUMP);
const fixture = mkdtempSync(join(tmpdir(), 'xchain-ui-dump-'));

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

describe('ui-dump readers', () => {
    it('parses node fields, bounds, and XML character references', () => {
        expect(nodes).toEqual([
            {
                text: 'Wallet & Vault A 🔑',
                contentDesc: 'Open <wallet> "now" \'please\'',
                resourceId: 'io.xchain:id/title',
                package: 'io.xchain.wallet',
                bounds: [10, 20, 111, 221],
            },
            {
                text: 'Recovery phrase',
                contentDesc: 'Protect recovery phrase',
                resourceId: 'io.xchain:id/recovery',
                package: 'io.xchain.wallet',
                bounds: [100, 200, 200, 300],
            },
        ]);
    });

    it('finds the first node matching every supplied field', () => {
        expect(findNode(nodes, {
            textContains: 'covery',
            contentDesc: 'Protect recovery phrase',
            resourceId: 'io.xchain:id/recovery',
        })).toBe(nodes[1]);
        expect(findNode(nodes, { text: 'Recovery phrase', resourceId: 'wrong' })).toBe(null);
    });

    it('returns integer tap centres', () => {
        expect(tapPoint(nodes[0])).toEqual([60, 120]);
    });

    it('returns only the first expected line absent from text and descriptions', () => {
        expect(firstMissingLine(nodes, ['Wallet & Vault A 🔑', 'Protect recovery phrase'])).toBe(null);
        expect(firstMissingLine(nodes, ['Recovery phrase', 'Missing first', 'Missing second']))
            .toBe('Missing first');
    });
});

describe('ui-dump CLI', () => {
    it('prints a tap point selected by exact text', () => {
        expect(execFileSync(process.execPath, [SCRIPT, 'tap', '--text', 'Recovery phrase'], {
            encoding: 'utf8',
            input: DUMP,
        })).toBe('150 250\n');
    });

    it('exits 1 when tap text does not match a node', () => {
        expect(() => execFileSync(process.execPath, [SCRIPT, 'tap', '--text', 'Not shown'], {
            encoding: 'utf8',
            input: DUMP,
        })).toThrow(expect.objectContaining({ status: 1 }));
    });

    it('prints the first missing line and exits 1', () => {
        const lines = join(fixture, 'lines.json');
        writeFileSync(lines, JSON.stringify(['Wallet & Vault A 🔑', 'Not shown', 'Also absent']));

        let failure;
        try {
            execFileSync(process.execPath, [SCRIPT, 'missing', lines], {
                encoding: 'utf8',
                input: DUMP,
            });
        } catch (error) {
            failure = error;
        }

        expect(failure?.status).toBe(1);
        expect(failure?.stdout).toBe('Not shown\n');
    });

    it('exits 0 when no line is missing', () => {
        const lines = join(fixture, 'complete.json');
        writeFileSync(lines, JSON.stringify(['Open <wallet> "now" \'please\'', 'Recovery phrase']));
        expect(execFileSync(process.execPath, [SCRIPT, 'missing', lines], {
            encoding: 'utf8',
            input: DUMP,
        })).toBe('');
    });
});
