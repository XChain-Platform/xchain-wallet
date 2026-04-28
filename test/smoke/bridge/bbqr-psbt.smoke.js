// Smoke for §20.4 / G043 — BBQr / UR PSBT QR (partial: BBQr H + B
// land now; BBQr Z (zlib) and UR are recognized but throw a clear
// "not yet supported" error).

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

// 2. Runtime — format detection.
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

assert.ok(describeUnsupportedFormat('ur')?.includes('UR'),
    'describeUnsupportedFormat surfaces a UR-specific message');
assert.equal(describeUnsupportedFormat('xcw'), null);
assert.equal(describeUnsupportedFormat('bbqr'), null,
    'BBQr is supported (H/B); unsupported variants surface via the BBQr decoder error');
assert.equal(describeUnsupportedFormat(null), null);

// 3. Runtime — BBQr decode (single-frame H).
const bbqrUrl = `file://${join(root, bbqrPath)}`;
const { parseBbqrFrame, decodeBbqrFrames, decodeBbqrPsbt, encodeBbqrPsbtFrames, BbqrError } =
    await import(bbqrUrl);

// Build a fake single-frame BBQr-PSBT-H. PSBT magic is "70736274ff"
// in hex; we don't need a real PSBT here — the BBQr layer just hands
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

// Multi-frame H — split the same payload into two halves.
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

// Z encoding throws a clear, named error rather than silently failing.
const zFrame = `B$ZP0100AAAAAAAA`;
assert.throws(() => decodeBbqrPsbt([zFrame]),
    /encoding "Z" \(zlib\) not yet supported/);

// File type other than P is rejected at decodeBbqrPsbt.
const txFrame = `B$HT0100DEADBEEF`;
assert.throws(() => decodeBbqrPsbt([txFrame]),
    /expected PSBT \(file type P\), got "T"/);

// Garbage frame.
assert.throws(() => parseBbqrFrame('notbbqr'),
    BbqrError);

// 4. encodeBbqrPsbtFrames — round-trip + shape.
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
assert.ok(/hex, base64, or BBQr PSBT/.test(formSrc),
    'fallback error mentions BBQr alongside hex / base64');

console.log('OK — BBQr PSBT decode + format detector + PsbtSignForm wiring smoke');
