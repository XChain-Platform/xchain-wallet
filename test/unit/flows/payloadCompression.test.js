// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// Client-side FILE payload inflation ( spec Part B), wallet side.
//
// The wallet is the ONLY layer that can inflate a gated payload: compression
// happens before encryption (§5.4), so the serving layer (which holds no key)
// must never try. These tests pin that asymmetry plus the fail-closed contract:
// a lying COMPRESSION field, a corrupt stream or a compression bomb must all
// end with the user seeing the decrypted bytes as stored-form, never partial
// output and never an exception in a renderer process.

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import {
    compressionFieldOf,
    declaresDeflateRaw,
    inflateDeflateRaw,
    inflateGatedPlaintext,
    resolveGatedCompression,
    COMPRESSION_MAX_RATIO,
} from '../../../packages/core/src/flows/payloadCompression.js';

const ORIGINAL = Buffer.from('gated wallet payload. '.repeat(400), 'utf8');
const DEFLATED = zlib.deflateRawSync(ORIGINAL);

describe('payloadCompression ( Part B)', () => {

    describe('compressionFieldOf', () => {
        it('reads the field from a FILE v0 action string', () => {
            expect(compressionFieldOf('FILE|0|a.txt|text/plain|T|M|||||1')).toBe('1');
        });

        it('returns empty for historical FILEs that omit it', () => {
            expect(compressionFieldOf('FILE|0|a.txt|text/plain')).toBe('');
            expect(compressionFieldOf('FILE|0|a.txt|text/plain|T|M')).toBe('');
        });

        it('ignores non-FILE actions and other versions', () => {
            expect(compressionFieldOf('SEND|0|X|1|a|b|c|d|e|f|1')).toBe('');
            expect(compressionFieldOf('FILE|1|a|b|c|d|||||1')).toBe('');
        });

        it('never throws on junk', () => {
            for (const junk of [null, undefined, '', 42, {}, []]) {
                expect(compressionFieldOf(junk)).toBe('');
            }
        });

        it('preserves an unknown code verbatim for diagnostics', () => {
            expect(compressionFieldOf('FILE|0|a|b|c|d|||||zstd')).toBe('zstd');
        });
    });

    describe('declaresDeflateRaw', () => {
        it('accepts only the known code', () => {
            expect(declaresDeflateRaw('1')).toBe(true);
            expect(declaresDeflateRaw(true)).toBe(true);
        });

        it('treats every unknown value as do-not-inflate', () => {
            // Forward compatibility: an old wallet meeting a future codec shows
            // stored bytes rather than crashing or guessing.
            for (const v of ['2', '99', 'zstd', '', ' 1', '01', null, undefined, 0, false, {}]) {
                expect(declaresDeflateRaw(v)).toBe(false);
            }
        });
    });

    describe('inflateDeflateRaw', () => {
        it('round-trips deflate-raw bytes', async () => {
            const r = await inflateDeflateRaw(new Uint8Array(DEFLATED));
            expect(r.inflated).toBe(true);
            expect(r.storedForm).toBe(false);
            expect(Buffer.from(r.bytes).equals(ORIGINAL)).toBe(true);
            expect(r.storedLength).toBe(DEFLATED.length);
            expect(r.originalLength).toBe(ORIGINAL.length);
        });

        it('fails closed on non-deflate bytes', async () => {
            const plain = Buffer.from('definitely not a deflate stream', 'utf8');
            const r = await inflateDeflateRaw(new Uint8Array(plain));
            expect(r.inflated).toBe(false);
            expect(r.storedForm).toBe(true);
            expect(r.error).toBe('INVALID_DEFLATE_STREAM');
            expect(Buffer.from(r.bytes).equals(plain)).toBe(true);
        });

        it('never returns partial output for a truncated stream', async () => {
            const truncated = DEFLATED.subarray(0, Math.floor(DEFLATED.length / 2));
            const r = await inflateDeflateRaw(new Uint8Array(truncated));
            expect(r.storedForm).toBe(true);
            expect(Buffer.from(r.bytes).equals(truncated)).toBe(true);
            expect(Buffer.from(r.bytes).includes(Buffer.from('gated wallet payload'))).toBe(false);
        });

        it('aborts a compression bomb on the ratio guard', async () => {
            const bomb = zlib.deflateRawSync(Buffer.alloc(4 * 1024 * 1024, 0));
            // Precondition: the ceiling really is below the full inflated size,
            // so this exercises the streamed abort and not a lucky success.
            expect(bomb.length * COMPRESSION_MAX_RATIO).toBeLessThan(4 * 1024 * 1024);
            const r = await inflateDeflateRaw(new Uint8Array(bomb));
            expect(r.inflated).toBe(false);
            expect(r.error).toBe('RATIO_GUARD_TRIPPED');
        });

        it('a payload just under the guard still inflates', async () => {
            const body = Buffer.from('ab'.repeat(1000) + Math.random(), 'utf8');
            const deflated = zlib.deflateRawSync(body);
            const ratio = body.length / deflated.length;
            if (ratio < COMPRESSION_MAX_RATIO) {
                const r = await inflateDeflateRaw(new Uint8Array(deflated));
                expect(r.inflated).toBe(true);
            }
        });

        it('never throws on hostile input', async () => {
            for (const input of [null, undefined, new Uint8Array(0), new Uint8Array([0]),
                                 new Uint8Array([255, 255, 255, 255])]) {
                const r = await inflateDeflateRaw(input);
                expect(r.bytes).toBeInstanceOf(Uint8Array);
                expect(typeof r.error === 'string' || r.error === null).toBe(true);
            }
        });
    });

    describe('inflateGatedPlaintext (§5.4 inflate-after-decrypt)', () => {
        it('inflates when the action declares deflate-raw', async () => {
            const r = await inflateGatedPlaintext(new Uint8Array(DEFLATED), '1');
            expect(r.inflated).toBe(true);
            expect(Buffer.from(r.bytes).equals(ORIGINAL)).toBe(true);
        });

        it('passes bytes through untouched when the action declares nothing', async () => {
            const r = await inflateGatedPlaintext(new Uint8Array(ORIGINAL), '');
            expect(r.inflated).toBe(false);
            expect(r.storedForm).toBe(false);
            expect(Buffer.from(r.bytes).equals(ORIGINAL)).toBe(true);
        });

        it('a LYING field yields stored-form with an explicit error, not a throw', async () => {
            // The decrypted bytes are plain text but the action claims deflate.
            const r = await inflateGatedPlaintext(new Uint8Array(ORIGINAL), '1');
            expect(r.inflated).toBe(false);
            expect(r.storedForm).toBe(true);
            expect(r.error).toBe('INVALID_DEFLATE_STREAM');
            expect(Buffer.from(r.bytes).equals(ORIGINAL)).toBe(true);
        });

        it('an unknown future codec is inert (no inflate, no error)', async () => {
            const r = await inflateGatedPlaintext(new Uint8Array(ORIGINAL), '2');
            expect(r.inflated).toBe(false);
            expect(r.storedForm).toBe(false);
            expect(r.error).toBeNull();
        });
    });

    describe('resolveGatedCompression', () => {
        it('an explicitly supplied value wins and costs no round trip', async () => {
            let called = false;
            const sdk = { getAction: async () => { called = true; return {}; } };
            const out = await resolveGatedCompression({ sdk, actionIndex: 42, declared: '1' });
            expect(out).toBe('1');
            expect(called).toBe(false);
        });

        it('falls back to the stored action string on the action record (§5.1)', async () => {
            const sdk = {
                getAction: async () => ({ data: { action_string: 'FILE|0|a.txt|text/plain|T|M|||||1' } }),
            };
            expect(await resolveGatedCompression({ sdk, actionIndex: 42 })).toBe('1');
        });

        it('falls back to a parsed COMPRESSION field when no action string is exposed', async () => {
            const sdk = { getAction: async () => ({ data: { COMPRESSION: '1' } }) };
            expect(await resolveGatedCompression({ sdk, actionIndex: 42 })).toBe('1');
        });

        it('returns empty (do not inflate) when the field is absent', async () => {
            const sdk = { getAction: async () => ({ data: { NAME: 'a.txt' } }) };
            expect(await resolveGatedCompression({ sdk, actionIndex: 42 })).toBe('');
        });

        it('degrades to empty when the probe throws, never propagating', async () => {
            const sdk = { getAction: async () => { throw new Error('explorer down'); } };
            expect(await resolveGatedCompression({ sdk, actionIndex: 42 })).toBe('');
        });

        it('degrades to empty when the sdk cannot fetch actions at all', async () => {
            expect(await resolveGatedCompression({ sdk: {}, actionIndex: 42 })).toBe('');
            expect(await resolveGatedCompression({ sdk: null, actionIndex: 42 })).toBe('');
        });
    });

    describe('end-to-end with the SDK gated helper', () => {
        it('what the SDK compressed-then-encrypted, the wallet decrypts-then-inflates', async () => {
            // Mirrors the real pipeline: SDK composes (compress -> encrypt),
            // wallet consumes (decrypt -> inflate).
            // By package name first : the SDK is a registry
            // dependency now, so this resolves out of node_modules on every
            // machine. It used to read four levels up to a sibling checkout
            // and quietly `return` where there was none, which meant this
            // cross-service check never ran in CI while the suite reported
            // green. The relative path stays as the `pnpm run sdk:link`
            // fallback.
            //
            // RESOLVED AT RUNTIME, NOT THROUGH A LITERAL SPECIFIER
            // . The fallback used to be a literal
            // `import('../../../../xchain-sdk/...')`, and a literal
            // specifier is exactly what Vite STATICALLY ANALYSES at
            // transform time. So on the machines the fallback exists for
            // the sake of not being on - CI, a clean clone, a release
            // runner - the whole test FILE failed to transform and never
            // reached the `.catch` meant to absorb it. It is the reverse of
            // the bug described above: that one skipped silently, this one
            // took the suite down with it. Measured red in CI, "Failed to
            // resolve import "../../../../xchain-sdk/src/gatedFile.js"".
            // `require` resolves through Node rather than through Vite,
            // which is how sendLegs.test.js already reaches the same SDK.
            const require_ = createRequire(import.meta.url);
            let GatedFileUtils = null;
            for (const specifier of [
                'xchain-sdk/src/gatedFile.js',
                '../../../../xchain-sdk/src/gatedFile.js',
            ]) {
                try {
                    GatedFileUtils = require_(specifier);
                    break;
                } catch {
                    // try the next specifier
                }
            }
            // AND IT NO LONGER SKIPS. The `return` that used to stand here
            // was written when the SDK was a sibling checkout that might
            // genuinely be absent. It is a registry dependency now, present
            // in every `pnpm install`, so an unresolvable SDK is a broken
            // install rather than a machine without one - and a silent
            // `return` would report green for the exact cross-service check
            // this test exists to make, which is the failure the comment
            // above already names.
            expect(GatedFileUtils, 'the SDK must resolve from node_modules').toBeTruthy();

            const gatedFile = new GatedFileUtils();
            const plaintext = Buffer.from('cross-service gated payload. '.repeat(300), 'utf8');
            const composed = await gatedFile.compressAndEncryptFileBytes(plaintext);
            expect(composed.compressed).toBe(true);
            expect(composed.compressionField).toBe('1');

            const decrypted = gatedFile.decryptFileBytes(composed.ciphertext, composed.key);
            const result = await inflateGatedPlaintext(new Uint8Array(decrypted), composed.compressionField);
            expect(result.inflated).toBe(true);
            expect(Buffer.from(result.bytes).equals(plaintext)).toBe(true);
        });
    });
});
