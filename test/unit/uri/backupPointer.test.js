// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.4 backup-pointer URI parse / build + QR classification.

import { describe, it, expect } from 'vitest';
import {
    parseBackupPointer,
    buildBackupPointer,
    looksLikeBackupPointer,
    InvalidBackupPointerError,
    BACKUP_POINTER_SCHEME,
} from '../../../packages/core/src/uri/backupPointer.js';
import { detectQrContent } from '../../../packages/core/src/uri/detectQrContent.js';

describe('uri/backupPointer', () => {
    describe('parseBackupPointer', () => {
        it('parses a minimal pointer with only a location', () => {
            const p = parseBackupPointer('xchain-backup:1?loc=https%3A%2F%2Fbackups.example%2Fa.json');
            expect(p.version).toBe(1);
            expect(p.location).toBe('https://backups.example/a.json');
            expect(p.name).toBeUndefined();
            expect(p.raw).toContain('xchain-backup:');
        });

        it('parses a pointer with a name label', () => {
            const p = parseBackupPointer('xchain-backup:1?loc=https%3A%2F%2Fx.example%2Fb&name=My%20Wallet');
            expect(p.location).toBe('https://x.example/b');
            expect(p.name).toBe('My Wallet');
        });

        it('accepts an on-chain style location scheme (resolution is a shell concern)', () => {
            const p = parseBackupPointer('xchain-backup:1?loc=xchain-file%3Abitcoin%2Fabc123');
            expect(p.location).toBe('xchain-file:bitcoin/abc123');
        });

        it('is case-insensitive on the scheme', () => {
            const p = parseBackupPointer('XCHAIN-BACKUP:1?loc=https%3A%2F%2Fx.example%2Fc');
            expect(p.location).toBe('https://x.example/c');
        });

        it('round-trips with buildBackupPointer', () => {
            const uri = buildBackupPointer({ location: 'https://x.example/d?tok=1', name: 'a & b' });
            const p = parseBackupPointer(uri);
            expect(p.location).toBe('https://x.example/d?tok=1');
            expect(p.name).toBe('a & b');
        });

        it('rejects the wrong scheme', () => {
            expect(() => parseBackupPointer('xchain:BTC?amount=1')).toThrow(InvalidBackupPointerError);
        });

        it('rejects a missing loc parameter', () => {
            expect(() => parseBackupPointer('xchain-backup:1?name=hi')).toThrow(/loc/);
        });

        it('rejects an empty loc parameter', () => {
            expect(() => parseBackupPointer('xchain-backup:1?loc=')).toThrow(/loc/);
        });

        it('rejects a missing query entirely', () => {
            expect(() => parseBackupPointer('xchain-backup:1')).toThrow(/loc/);
        });

        it('rejects an unsupported version', () => {
            expect(() => parseBackupPointer('xchain-backup:2?loc=https%3A%2F%2Fx')).toThrow(/version/);
        });

        it('rejects a non-numeric version', () => {
            expect(() => parseBackupPointer('xchain-backup:v1?loc=https%3A%2F%2Fx')).toThrow(/version/);
        });

        it('rejects a non-string input', () => {
            expect(() => parseBackupPointer(null)).toThrow(InvalidBackupPointerError);
        });
    });

    describe('buildBackupPointer', () => {
        it('requires a location', () => {
            expect(() => buildBackupPointer({})).toThrow(InvalidBackupPointerError);
            expect(() => buildBackupPointer({ location: '   ' })).toThrow(InvalidBackupPointerError);
        });

        it('omits name when not given', () => {
            const uri = buildBackupPointer({ location: 'https://x.example/e' });
            expect(uri).toBe(`${BACKUP_POINTER_SCHEME}:1?loc=https%3A%2F%2Fx.example%2Fe`);
        });
    });

    describe('looksLikeBackupPointer', () => {
        it('is true for the pointer scheme even when malformed', () => {
            expect(looksLikeBackupPointer('xchain-backup:garbage')).toBe(true);
            expect(looksLikeBackupPointer('  xchain-backup:1?loc=https%3A%2F%2Fx ')).toBe(true);
        });

        it('is false for other schemes / junk', () => {
            expect(looksLikeBackupPointer('xchain:BTC')).toBe(false);
            expect(looksLikeBackupPointer('bitcoin:bc1qxyz')).toBe(false);
            expect(looksLikeBackupPointer('not a uri')).toBe(false);
            expect(looksLikeBackupPointer(42)).toBe(false);
        });
    });

    describe('detectQrContent classification', () => {
        it('classifies a valid pointer as backup-pointer', () => {
            const r = detectQrContent('xchain-backup:1?loc=https%3A%2F%2Fx.example%2Ff&name=Rig');
            expect(r.type).toBe('backup-pointer');
            expect(r.pointer.location).toBe('https://x.example/f');
            expect(r.pointer.name).toBe('Rig');
        });

        it('classifies a malformed pointer as unknown (not something else)', () => {
            // Right scheme, no loc: nothing else claims this scheme.
            expect(detectQrContent('xchain-backup:1?name=hi').type).toBe('unknown');
        });

        it('does not misclassify an xchain: action URI as a backup pointer', () => {
            const r = detectQrContent('xchain:BTC?amount=1');
            expect(r.type).not.toBe('backup-pointer');
        });
    });
});
