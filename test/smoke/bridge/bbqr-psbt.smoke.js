// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20.4 / G043: BBQr / UR PSBT QR. BBQr H + B + Z all decode
// (Cluster U FOLLOWUP 1 wired Z via pako); UR crypto-psbt (single + fountain
// multi-part) decodes via urPsbt.js (Cluster U FOLLOWUP 2). Deep UR codec
// coverage lives in test/unit/uri/urPsbt.test.js against bc-ur gold vectors.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Modules exist.
const bbqrPath = 'packages/core/src/uri/bbqrPsbt.js';
const fmtPath = 'packages/core/src/uri/qrPsbtFormat.js';
assert.ok(existsSync(join(root, bbqrPath)), `${bbqrPath} exists`);
assert.ok(existsSync(join(root, fmtPath)), `${fmtPath} exists`);

const bbqrSrc = read(bbqrPath);
for (const fn of ['parseBbqrFrame', 'decodeBbqrFrames', 'decodeBbqrPsbt', 'encodeBbqrPsbtFrames']) {
    assert.ok(new RegExp(`export function ${fn}\\(`).test(bbqrSrc),
        `bbqrPsbt exports ${fn}`);
}

const fmtSrc = read(fmtPath);
for (const fn of ['detectQrFrameFormat', 'describeUnsupportedFormat']) {
    assert.ok(new RegExp(`export function ${fn}\\(`).test(fmtSrc),
        `qrPsbtFormat exports ${fn}`);
}

// 2. Runtime: format detection.
const fmtUrl = `file://${join(root, fmtPath)}`;
const { detectQrFrameFormat, describeUnsupportedFormat } = await import(fmtUrl);

assert.equal(detectQrFrameFormat('XCW:1/2:deadbeef:abc'), 'xcw');
assert.equal(detectQrFrameFormat('B$HP01000A1B2C'), 'bbqr');  // total=1, index=0
assert.equal(detectQrFrameFormat('ur:crypto-psbt/abcd'), 'ur');
assert.equal(detectQrFrameFormat('UR:crypto-psbt/abcd'), 'ur', 'UR detection is case-insensitive');
assert.equal(detectQrFrameFormat('not a frame'), null, 'unknown text returns null');
assert.equal(detectQrFrameFormat(''), null);
assert.equal(detectQrFrameFormat(null), null);
assert.equal(detectQrFrameFormat(123), null);

// All three QR PSBT formats decode now (UR landed in Cluster U FOLLOWUP 2),
// so describeUnsupportedFormat flags none of them; it stays for any future
// format added before its decoder.
assert.equal(describeUnsupportedFormat('ur'), null,
    'UR is supported now (Cluster U FU 2); no unsupported message');
assert.equal(describeUnsupportedFormat('xcw'), null);
assert.equal(describeUnsupportedFormat('bbqr'), null,
    'BBQr is supported (H/B/Z); unsupported variants surface via the BBQr decoder error');
assert.equal(describeUnsupportedFormat(null), null);

// 3. Runtime: BBQr decode (single-frame H).
const bbqrUrl = `file://${join(root, bbqrPath)}`;
const { parseBbqrFrame, decodeBbqrFrames, decodeBbqrPsbt, encodeBbqrPsbtFrames, BbqrError } =
    await import(bbqrUrl);

// Build a fake single-frame BBQr-PSBT-H. PSBT magic is "70736274ff"
// in hex; we don't need a real PSBT here: the BBQr layer just hands
// bytes back, and decodeBbqrPsbt asserts file-type P only.
const samplePsbtHex = '70736274ff0001020304';
const sampleSingleH = `B$HP0100${samplePsbtHex.toUpperCase()}`;
const headerH = parseBbqrFrame(sampleSingleH);
assert.equal(headerH.encoding, 'H');
assert.equal(headerH.fileType, 'P');
assert.equal(headerH.total, 1);
assert.equal(headerH.index, 0);
const decodedH = decodeBbqrPsbt([sampleSingleH]);
assert.equal(decodedH.psbtHex, samplePsbtHex);
assert.equal(decodedH.psbt instanceof Uint8Array, true);

// Multi-frame H: split the same payload into two halves.
const half1 = samplePsbtHex.slice(0, 10).toUpperCase();
const half2 = samplePsbtHex.slice(10).toUpperCase();
const multiH1 = `B$HP0200${half1}`;
const multiH2 = `B$HP0201${half2}`;
const decodedMulti = decodeBbqrPsbt([multiH1, multiH2]);
assert.equal(decodedMulti.psbtHex, samplePsbtHex);

// Out-of-order multi-frame works.
const decodedMultiOoo = decodeBbqrPsbt([multiH2, multiH1]);
assert.equal(decodedMultiOoo.psbtHex, samplePsbtHex);

// Duplicate frame ignored when payload matches.
const decodedDup = decodeBbqrPsbt([multiH1, multiH2, multiH1]);
assert.equal(decodedDup.psbtHex, samplePsbtHex);

// Missing frame surfaces a clear error.
assert.throws(() => decodeBbqrPsbt([multiH1]),
    /missing frame index 1/);

// Mismatched total across frames.
assert.throws(() => decodeBbqrPsbt([`B$HP0200${half1}`, `B$HP0301${half2}`]),
    /total mismatch/);

// Encoding mismatch.
assert.throws(() => decodeBbqrPsbt([`B$HP0200${half1}`, `B$BP0201ABCDEFGH`]),
    /encoding mismatch/);

// Z encoding round-trip: generate a zlib-compressed PSBT, base32 it
// (no padding), wrap in a BBQr Z frame, and decode back. This is the
// shape Coldcard / SeedSigner emit when sending a signed PSBT back
// to a host. Pako is the runtime dep.
const pako = (await import('pako')).default;
const { base32 } = await import('@scure/base');

function makeZFrames(hexPsbt, payloadBytes) {
    const psbtBytes = Uint8Array.from(
        hexPsbt.match(/.{2}/g).map((h) => parseInt(h, 16)),
    );
    const compressed = pako.deflate(psbtBytes);
    const b32 = base32.encode(compressed).replace(/=+$/, '');
    const frames = [];
    const chunks = Math.ceil(b32.length / payloadBytes);
    const fmt36 = (n) => {
        const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        return A[Math.floor(n / 36)] + A[n % 36];
    };
    for (let i = 0; i < chunks; i++) {
        frames.push(`B$ZP${fmt36(chunks)}${fmt36(i)}${b32.slice(i * payloadBytes, (i + 1) * payloadBytes)}`);
    }
    return frames;
}

const zFramesSingle = makeZFrames(samplePsbtHex, 4096);
assert.equal(zFramesSingle.length, 1, 'small PSBT fits in one Z frame');
const decodedZ = decodeBbqrPsbt(zFramesSingle);
assert.equal(decodedZ.psbtHex, samplePsbtHex,
    'BBQr Z single-frame round-trip preserves PSBT hex');

const zFramesMulti = makeZFrames(samplePsbtHex, 4);
assert.ok(zFramesMulti.length >= 2, 'multi-frame Z splits across chunks');
const decodedZMulti = decodeBbqrPsbt(zFramesMulti);
assert.equal(decodedZMulti.psbtHex, samplePsbtHex,
    'BBQr Z multi-frame round-trip preserves PSBT hex');

// Out-of-order Z frames also reassemble correctly.
const decodedZOoo = decodeBbqrPsbt([...zFramesMulti].reverse());
assert.equal(decodedZOoo.psbtHex, samplePsbtHex,
    'BBQr Z out-of-order round-trip works');

// Bigger PSBT to exercise the size-win that motivates Z in production.
const biggerSampleHex = '70736274ff' + '0102030405'.repeat(80);  // ~405 bytes
const biggerZ = makeZFrames(biggerSampleHex, 200);
const biggerZDecoded = decodeBbqrPsbt(biggerZ);
assert.equal(biggerZDecoded.psbtHex, biggerSampleHex,
    'BBQr Z round-trip preserves a larger PSBT');

// Corrupted Z payload surfaces a wrapped BbqrError, not a raw pako exception.
// Use base32 chars that decode to bytes that are neither a valid zlib header
// nor a valid raw-deflate stream. Zero-byte runs are the most reliable
// way to force both inflate paths to reject.
const garbageZ = 'B$ZP0100AAAAAAAA';
assert.throws(() => decodeBbqrPsbt([garbageZ]),
    BbqrError, 'corrupted Z payload throws a typed BbqrError');

// File type other than P is rejected at decodeBbqrPsbt.
const txFrame = `B$HT0100DEADBEEF`;
assert.throws(() => decodeBbqrPsbt([txFrame]),
    /expected PSBT \(file type P\), got "T"/);

// Garbage frame.
assert.throws(() => parseBbqrFrame('notbbqr'),
    BbqrError);

// 4. encodeBbqrPsbtFrames: round-trip + shape.
//
// Single-frame: payload fits in one chunk.
const tinyHex = '70736274ff' + '00'.repeat(40);  // 45 bytes
const singleFrames = encodeBbqrPsbtFrames(tinyHex, { payloadBytes: 200 });
assert.equal(singleFrames.length, 1, 'small PSBT fits in one BBQr H frame');
assert.ok(singleFrames[0].startsWith('B$HP0100'), 'frame header is B$HP0100 (total=1, index=0)');
const tinyDecoded = decodeBbqrPsbt(singleFrames);
assert.equal(tinyDecoded.psbtHex, tinyHex, 'BBQr H round-trip preserves the PSBT hex');

// Multi-frame: force chunking with a small payloadBytes.
const biggerHex = '70736274ff' + '01020304'.repeat(50);  // 205 bytes
const multiFrames = encodeBbqrPsbtFrames(biggerHex, { payloadBytes: 100 });
assert.ok(multiFrames.length >= 2, 'larger PSBT chunked into multiple BBQr frames');
for (let i = 0; i < multiFrames.length; i++) {
    const parsed = parseBbqrFrame(multiFrames[i]);
    assert.equal(parsed.encoding, 'H');
    assert.equal(parsed.fileType, 'P');
    assert.equal(parsed.total, multiFrames.length);
    assert.equal(parsed.index, i);
}
const biggerDecoded = decodeBbqrPsbt(multiFrames);
assert.equal(biggerDecoded.psbtHex, biggerHex, 'multi-frame BBQr H round-trip preserves the PSBT hex');

// Empty PSBT rejected.
assert.throws(() => encodeBbqrPsbtFrames(''), /empty PSBT/);
assert.throws(() => encodeBbqrPsbtFrames(new Uint8Array(0)), /empty PSBT/);

// Invalid hex rejected.
assert.throws(() => encodeBbqrPsbtFrames('not-hex'), /even-length 0-9a-f/);

// Bad payloadBytes rejected.
assert.throws(() => encodeBbqrPsbtFrames(tinyHex, { payloadBytes: 0 }),
    /positive integer/);

// 5. PsbtSignForm wires the decoder into normalizePsbtInput.
const formSrc = read('packages/core/src/shared/routes/PsbtSignForm.jsx');
assert.ok(/import \{ decodeBbqrPsbt \} from '\.\.\/\.\.\/uri\/bbqrPsbt\.js'/.test(formSrc),
    'PsbtSignForm imports decodeBbqrPsbt');
assert.ok(/import \{ detectQrFrameFormat, describeUnsupportedFormat \} from '\.\.\/\.\.\/uri\/qrPsbtFormat\.js'/.test(formSrc),
    'PsbtSignForm imports the format detector');
assert.ok(/frames\.every\(\(f\) => detectQrFrameFormat\(f\) === 'bbqr'\)/.test(formSrc),
    'normalizePsbtInput dispatches BBQr-only inputs to decodeBbqrPsbt');
assert.ok(/unsupportedFormatHint/.test(formSrc),
    'PsbtSignForm computes a format-specific hint for unsupported pastes');
assert.ok(/hex, base64, or BBQr transaction/.test(formSrc),
    'fallback error mentions BBQr alongside hex / base64');

console.log('OK: BBQr PSBT decode + format detector + PsbtSignForm wiring smoke');
