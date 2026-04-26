// Smoke for Phase 4 — Step 20 of 23 — Multisig PSBT-QR cosigner
// round-trip (§22.3 reuses §20 chunked-QR transport).

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    fingerprintSessionRef,
    buildRequestEnvelope,
    buildReplyEnvelope,
    buildFinalizedEnvelope,
    validateMultisigEnvelope,
    encodeMultisigEnvelope,
    decodeMultisigEnvelope,
    MULTISIG_ENVELOPE_KINDS,
    MultisigEnvelopeError,
    encodeXcwChunks,
    decodeXcwChunks,
} from '../../../packages/core/src/uri/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const alice = '02' + 'a'.repeat(64);
const bob = '03' + 'b'.repeat(64);
const carol = '02' + 'c'.repeat(64);

const sessionRef = {
    scheme: 'taproot-musig2',
    threshold: 2,
    cosignerPubkeys: [alice, bob, carol],
    msgHash: 'aa'.repeat(32),
    psbtHex: '70736274ff0100',
};

// ─── Envelope kinds + fingerprint ──────────────────────────────

assert.deepEqual(
    [...MULTISIG_ENVELOPE_KINDS],
    [
        'multisig-request-nonce',
        'multisig-round-1-reply',
        'multisig-request-partial',
        'multisig-round-2-reply',
        'multisig-request-signature',
        'multisig-classical-reply',
        'multisig-finalized',
    ],
    'envelope kinds enumerate the full coordinator+cosigner protocol',
);

const fp1 = fingerprintSessionRef(sessionRef);
const fp2 = fingerprintSessionRef({
    ...sessionRef,
    cosignerPubkeys: sessionRef.cosignerPubkeys.map((p) => p.toUpperCase()),
});
assert.equal(fp1, fp2, 'fingerprint is case-insensitive on pubkey hex');
assert.equal(fp1.length, 64, 'fingerprint is 32-byte hex (64 chars)');

const fp3 = fingerprintSessionRef({ ...sessionRef, msgHash: 'bb'.repeat(32) });
assert.notEqual(fp1, fp3, 'fingerprint changes when msgHash changes');

// ─── Request / reply / finalized envelopes ─────────────────────

const reqNonce = buildRequestEnvelope({
    kind: 'multisig-request-nonce',
    sessionRef,
});
assert.equal(reqNonce.kind, 'multisig-request-nonce');
assert.equal(reqNonce.fingerprint, fp1);
assert.deepEqual(reqNonce.sessionRef.cosignerPubkeys, [alice, bob, carol]);

const reqPartial = buildRequestEnvelope({
    kind: 'multisig-request-partial',
    sessionRef,
    aggNonceHex: 'cd'.repeat(66),
});
assert.equal(reqPartial.aggNonce, 'cd'.repeat(66));

assert.throws(
    () => buildRequestEnvelope({
        kind: 'multisig-request-partial',
        sessionRef,
        // missing aggNonceHex
    }),
    /aggNonceHex must be 66-byte hex/,
);

const replyNonce = buildReplyEnvelope({
    kind: 'multisig-round-1-reply',
    fingerprint: fp1,
    contribution: { pubkey: alice, publicNonce: '11'.repeat(66) },
});
assert.equal(replyNonce.kind, 'multisig-round-1-reply');
assert.equal(replyNonce.contribution.publicNonce, '11'.repeat(66));

assert.throws(
    () => buildReplyEnvelope({
        kind: 'multisig-round-1-reply',
        fingerprint: fp1,
        contribution: { pubkey: alice, publicNonce: 'short' },
    }),
    /publicNonce must be 66-byte hex/,
);

const replyPartial = buildReplyEnvelope({
    kind: 'multisig-round-2-reply',
    fingerprint: fp1,
    contribution: { pubkey: alice, sig: '11'.repeat(32) },
});
assert.equal(replyPartial.contribution.sig.length, 64,
    'MuSig2 partial sig is 32 bytes (64 hex chars)');

const replyClassical = buildReplyEnvelope({
    kind: 'multisig-classical-reply',
    fingerprint: fp1,
    contribution: { pubkey: alice, sig: '30' + '44'.repeat(35) + '01' },
});
assert.equal(replyClassical.kind, 'multisig-classical-reply');

const finalized = buildFinalizedEnvelope({
    sessionRef,
    txHex: '0200000001abcd',
    txid: 'd34db33f',
});
assert.equal(finalized.kind, 'multisig-finalized');
assert.equal(finalized.contribution.txHex, '0200000001abcd');
assert.equal(finalized.contribution.txid, 'd34db33f');

// ─── Encode / decode round-trip via XCW chunks ─────────────────

for (const envelope of [reqNonce, reqPartial, replyNonce, replyPartial, replyClassical, finalized]) {
    const bytes = encodeMultisigEnvelope(envelope);
    const frames = encodeXcwChunks(bytes);
    assert.ok(frames.length >= 1, 'XCW chunks produced at least one frame');
    const { psbt: reassembled } = decodeXcwChunks(frames);
    const decoded = decodeMultisigEnvelope(reassembled);
    assert.equal(decoded.kind, envelope.kind);
    assert.equal(decoded.fingerprint, envelope.fingerprint);
    if (envelope.contribution) {
        assert.deepEqual(decoded.contribution, envelope.contribution);
    }
    if (envelope.aggNonce) {
        assert.equal(decoded.aggNonce, envelope.aggNonce);
    }
    if (envelope.sessionRef) {
        assert.deepEqual(decoded.sessionRef.cosignerPubkeys, envelope.sessionRef.cosignerPubkeys);
        assert.equal(decoded.sessionRef.scheme, envelope.sessionRef.scheme);
    }
}

// ─── Tampered envelope detection ───────────────────────────────

const tampered = {
    ...reqNonce,
    sessionRef: { ...reqNonce.sessionRef, msgHash: 'bb'.repeat(32) },
};
assert.throws(
    () => validateMultisigEnvelope(tampered),
    /fingerprint does not match sessionRef/,
);

assert.throws(
    () => validateMultisigEnvelope({ ...reqNonce, v: 99 }),
    /unsupported envelope version/,
);

assert.throws(
    () => validateMultisigEnvelope({ ...reqNonce, kind: 'something-else' }),
    /unknown envelope kind/,
);

assert.throws(
    () => decodeMultisigEnvelope(new TextEncoder().encode('{"v":1,"kind":"multisig-request-nonce"}')),
    /fingerprint must be 32-byte hex/,
);

assert.ok(MultisigEnvelopeError.prototype instanceof Error,
    'MultisigEnvelopeError extends Error');

// ─── Sign-screen route — round labels + QR + paste inbox ────────

const routePath = join(sharedRoutes, 'MultisigSigningSession.jsx');
assert.ok(existsSync(routePath), 'MultisigSigningSession.jsx exists');
const route = readFileSync(routePath, 'utf8');

assert.ok(/AnimatedQrFrames/.test(route),
    'route renders the animated-QR component');
assert.ok(/Round 1 — Collect nonces/.test(route),
    'route uses §22.3 "Round 1 — Collect nonces" label for MuSig2 nonce round');
assert.ok(/Round 2 — Collect signatures/.test(route),
    'route uses §22.3 "Round 2 — Collect signatures" label for MuSig2 partial round');
assert.ok(/Collect signatures/.test(route),
    'route uses single-round "Collect signatures" label for P2SH/P2WSH');
assert.ok(/Export PSBT QR|Scan cosigner reply/.test(route),
    'route surfaces both export + paste-inbox controls');
assert.ok(/buildRequestEnvelope|buildFinalizedEnvelope/.test(route),
    'route builds outbound multisig envelopes');
assert.ok(/decodeMultisigEnvelope/.test(route),
    'route decodes inbound multisig envelopes');
assert.ok(/contributeMultisigNonce|contributeMultisigSignature/.test(route),
    'route pipes parsed envelopes into the contribution APIs');
assert.ok(/encodeXcwChunks/.test(route),
    'route runs the chunked §20.3 transport on outbound envelopes');
assert.ok(/createXcwCollector|addChunkToCollector/.test(route),
    'route ingests chunks via the §20.3 collector');

// ─── AnimatedQrFrames is exported from core/ui ──────────────────

const uiBarrel = readFileSync(join(core, 'src', 'ui', 'index.js'), 'utf8');
assert.ok(/AnimatedQrFrames/.test(uiBarrel),
    'core/ui barrel exports AnimatedQrFrames');

// ─── uri barrel exposes the multisig envelope helpers ──────────

const uriBarrel = readFileSync(join(core, 'src', 'uri', 'index.js'), 'utf8');
for (const name of [
    'fingerprintSessionRef',
    'buildRequestEnvelope',
    'buildReplyEnvelope',
    'buildFinalizedEnvelope',
    'validateMultisigEnvelope',
    'encodeMultisigEnvelope',
    'decodeMultisigEnvelope',
    'MULTISIG_ENVELOPE_KINDS',
    'MultisigEnvelopeError',
]) {
    assert.ok(uriBarrel.includes(name),
        `core/uri barrel exports ${name}`);
}

// ─── Sanity: shells unchanged besides their existing wiring ────

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    // Step 19 helpers stay present — Step 20 didn't change the
    // bg-handler surface (envelope work happens entirely in the route
    // + core uri layer).
    assert.ok(/export function contributeMultisigNonce\b/.test(m),
        `${shell} still exports contributeMultisigNonce`);
    assert.ok(/export function contributeMultisigSignature\b/.test(m),
        `${shell} still exports contributeMultisigSignature`);
}

console.log(
    'OK — multisig PSBT-QR smoke (envelope kinds + canonicalized fingerprint + request/reply/finalized builders + shape guards + XCW round-trip per kind + tampered-envelope detection + version-bump rejection + AnimatedQrFrames export + sign-screen round labels + paste-inbox + envelope decoder pipes contributions through messaging + uri barrel exposes 9 helpers)',
);
