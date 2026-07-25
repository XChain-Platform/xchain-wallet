// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-28 encoding-aware size limits. The pinned strings and worked
// examples below were verified against the REAL xchain-sdk
// (FormatSelector.serialize, messaging.eciesEncryptBytes) and real
// bitcoinjs script.compile in the 2026-07-25 offline verification run
// (claude/reports build note); if the SDK's serializer or the ECIES
// envelope ever changes shape, these pins catch the drift.

import { describe, it, expect } from 'vitest';
import {
    MAX_COMPILED_ACTION_BYTES,
    AES_GCM_ENVELOPE_BYTES,
    ECIES_HANDOFF_HEX_CHARS,
    pushPrefixSize,
    publicFileActionString,
    gatedBatchActionString,
    maxPublicFileBytes,
    maxGatedPlaintextBytes,
} from '../../../packages/core/src/flows/fileSizeLimits.js';

const utf8len = (s) => new TextEncoder().encode(s).length;

describe('pushPrefixSize', () => {
    it('matches minimal-push prefix widths at the boundaries', () => {
        expect(pushPrefixSize(0)).toBe(1);
        expect(pushPrefixSize(75)).toBe(1);   // widest direct push
        expect(pushPrefixSize(76)).toBe(2);   // OP_PUSHDATA1 starts
        expect(pushPrefixSize(255)).toBe(2);
        expect(pushPrefixSize(256)).toBe(3);  // OP_PUSHDATA2 starts
        expect(pushPrefixSize(65535)).toBe(3);
    });
});

describe('publicFileActionString (mirror of SDK FormatSelector.serialize)', () => {
    it('trims trailing empty fields down to FILE|0|NAME|TYPE', () => {
        expect(publicFileActionString({ name: 'a.png', type: 'image/png' }))
            .toBe('FILE|0|a.png|image/png');
    });
    it('keeps interior empties when a later field is set', () => {
        expect(publicFileActionString({ name: 'a.png', type: 'image/png', memo: 'M' }))
            .toBe('FILE|0|a.png|image/png||M');
        expect(publicFileActionString({ name: 'a.png', type: 'image/png', title: 'T' }))
            .toBe('FILE|0|a.png|image/png|T');
    });
    it('trims NAME/TYPE/TITLE but keeps MEMO verbatim (fileAction contract)', () => {
        expect(publicFileActionString({ name: ' a.png ', type: ' image/png ', title: ' T ', memo: ' m ' }))
            .toBe('FILE|0|a.png|image/png|T| m ');
    });
});

describe('maxPublicFileBytes', () => {
    it('computes the exact budget for the pinned example', () => {
        // 'FILE|0|a.png|image/png' = 22 bytes -> 1-byte prefix -> 8169
        // budget for the raw push -> 8166 + its 3-byte prefix = 8169.
        expect(maxPublicFileBytes({ name: 'a.png', type: 'image/png' })).toBe(8166);
    });
    it('max + both push prefixes lands exactly at or under the compiled ceiling, +1 exceeds it', () => {
        for (const meta of [
            { name: 'a.png', type: 'image/png' },
            { name: 'file-with-a-much-longer-name.tar.gz', type: 'application/gzip', title: 'A title', memo: 'and a memo' },
            { name: 'ü.png', type: 'image/png', title: 'tïtle', memo: 'mémo' },
        ]) {
            const a = utf8len(publicFileActionString(meta));
            const max = maxPublicFileBytes(meta);
            const compiled = (n) => a + pushPrefixSize(a) + n + pushPrefixSize(n);
            expect(compiled(max)).toBeLessThanOrEqual(MAX_COMPILED_ACTION_BYTES);
            expect(compiled(max + 1)).toBeGreaterThan(MAX_COMPILED_ACTION_BYTES);
        }
    });
    it('unicode metadata is measured in UTF-8 bytes, not chars', () => {
        const ascii = maxPublicFileBytes({ name: 'aa.png', type: 'image/png' });
        const unicode = maxPublicFileBytes({ name: 'ü.png', type: 'image/png' });
        // 'ü' is 1 char but 2 UTF-8 bytes; both names serialize to 6 bytes.
        expect(unicode).toBe(ascii);
    });
});

describe('gatedBatchActionString / maxGatedPlaintextBytes', () => {
    const meta = {
        name: 'stems.zip',
        type: 'application/zip',
        title: '',
        memo: '',
        gateTicker: 'PEPECREATURE',
        coin: 'BTC',
        address: 'bcrt1qexampleaddr000000000000000000000000000',
    };

    it('mirrors the gatedPublishAction compose shape with fixed-width placeholders', () => {
        const s = gatedBatchActionString(meta);
        expect(s.startsWith('BATCH|0|FILE|0|stems.zip|application/zip|||PEPECREATURE|1|')).toBe(true);
        expect(s).toContain(`;MESSAGE|2|BTC|${meta.address}|`);
        // KEY_HASH placeholder: 64 hex chars; handoff placeholder: 190.
        expect(s).toContain('k'.repeat(64));
        expect(s).toContain('e'.repeat(ECIES_HANDOFF_HEX_CHARS));
        // Pinned against the real compose in the offline verification run.
        expect(utf8len(s)).toBe(372);
    });

    it('computes the pinned worked example', () => {
        // 372-byte BATCH string -> 3-byte prefix -> ciphertext budget
        // 7817 -> max ciphertext 7814 -> minus 28-byte AES-GCM envelope.
        expect(maxGatedPlaintextBytes(meta)).toBe(7786);
    });

    it('ciphertext at the cap compiles at or under the ceiling, +1 exceeds it', () => {
        const a = utf8len(gatedBatchActionString(meta));
        const cap = maxGatedPlaintextBytes(meta);
        const compiled = (plain) => {
            const ct = plain + AES_GCM_ENVELOPE_BYTES;
            return a + pushPrefixSize(a) + ct + pushPrefixSize(ct);
        };
        expect(compiled(cap)).toBeLessThanOrEqual(MAX_COMPILED_ACTION_BYTES);
        expect(compiled(cap + 1)).toBeGreaterThan(MAX_COMPILED_ACTION_BYTES);
    });

    it('uppercases the gate ticker like the flow does', () => {
        const lower = maxGatedPlaintextBytes({ ...meta, gateTicker: 'pepecreature' });
        expect(lower).toBe(maxGatedPlaintextBytes(meta));
    });

    it('longer metadata shrinks the budget; pathological metadata can undercut the legacy floor', () => {
        const long = maxGatedPlaintextBytes({
            ...meta,
            title: 'T'.repeat(600),
            memo: 'M'.repeat(1200),
        });
        expect(long).toBeLessThan(maxGatedPlaintextBytes(meta) - 1700);
        expect(long).toBeLessThan(6500);
    });
});

// --- PC-29: GATE_MIN_AMOUNT in the gated budget ------------------------
describe('gated action string with a PC-29 unlock threshold', () => {
    const META = {
        name: 'a.bin', type: 'application/octet-stream', title: '', memo: '',
        gateTicker: 'GATED', coin: 'BTC', address: 'bcrt1qissuer',
    };

    it('appends GATE_MIN_AMOUNT as a ninth FILE field', () => {
        const without = gatedBatchActionString(META);
        const withThr = gatedBatchActionString({ ...META, gateMinAmount: '2.5' });
        // The threshold lands INSIDE the FILE sub-command, before the
        // ';MESSAGE' separator, mirroring gatedPublishAction's compose.
        const [fileWithout] = without.split(';');
        const [fileWith, msgWith] = withThr.split(';');
        expect(fileWith).toBe(`${fileWithout}|2.5`);
        expect(msgWith).toBe(without.split(';')[1]);
    });

    it('absent / empty threshold stays byte-identical to the 8-field form', () => {
        const base = gatedBatchActionString(META);
        expect(gatedBatchActionString({ ...META, gateMinAmount: null })).toBe(base);
        expect(gatedBatchActionString({ ...META, gateMinAmount: '' })).toBe(base);
    });

    it('the plaintext ceiling shrinks by exactly the field width', () => {
        const base = maxGatedPlaintextBytes(META);
        const withThr = maxGatedPlaintextBytes({ ...META, gateMinAmount: '2.5' });
        // '|2.5' = 4 extra action-string bytes (no push-prefix boundary
        // crossed at this size).
        expect(base - withThr).toBe(4);
    });
});
