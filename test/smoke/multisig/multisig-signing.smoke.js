// Smoke for Phase 4 — Step 19 of 23 — Multisig-aware sign-round
// persistence + dual-mode partial-signature tracking (§22.3 + §42.9).

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 18 doesn't expose `crypto` as a free-identifier global; the
// schema factories call `crypto.randomUUID()`. Make the WebCrypto
// global available before pulling in the schema module.
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    createMultisigSigningSession,
    validateMultisigSigningSession,
    pendingCosignerPubkeys,
    progressSummary,
    MULTISIG_SESSION_STATUSES,
} from '../../../packages/core/src/schemas/multisigSigningSession.js';
import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// ─── Schema ──────────────────────────────────────────────────────

assert.deepEqual(
    [...MULTISIG_SESSION_STATUSES],
    [
        'collecting-nonces',
        'collecting-sigs',
        'ready-to-finalize',
        'finalized',
        'broadcast',
        'cancelled',
    ],
    'MULTISIG_SESSION_STATUSES exposes the full state-machine alphabet',
);

// validateMultisigSigningSession rejects nonsense.
assert.equal(validateMultisigSigningSession(null).ok, false, 'rejects null');
assert.equal(validateMultisigSigningSession({}).ok, false, 'rejects empty');

// Two cosigner pubkeys, 2-of-2 threshold; aliceN/aliceP form a happy-path session.
const alicePk = '02' + 'a'.repeat(64);
const bobPk = '03' + 'b'.repeat(64);
const carolPk = '02' + 'c'.repeat(64);
const sample = (overrides) => ({
    walletId: 'w1',
    chainId: 'bitcoin-mainnet',
    msgHash: 'aa'.repeat(32),
    psbtHex: '70736274ff0100',
    actionSummary: 'Send 0.001 BTC to bc1q…',
    ...overrides,
});

const p2wsh = createMultisigSigningSession(sample({
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: [alicePk, bobPk, carolPk],
}));
assert.equal(p2wsh.status, 'collecting-sigs', 'P2WSH starts in single-round status');
assert.equal(p2wsh.scheme, 'p2wsh-multisig');
assert.equal(p2wsh.threshold, 2);
assert.equal(p2wsh.cosignerPubkeys.length, 3);
assert.equal(p2wsh.signatures.length, 0);
assert.equal(p2wsh.nonces.length, 0);
assert.equal(p2wsh.aggNonce, null);
assert.equal(p2wsh.aggregatedSchnorrSig, null);
assert.equal(validateMultisigSigningSession(p2wsh).ok, true, 'P2WSH session validates');

const musig2 = createMultisigSigningSession(sample({
    scheme: 'taproot-musig2',
    threshold: 2,
    cosignerPubkeys: [alicePk, bobPk],
}));
assert.equal(musig2.status, 'collecting-nonces', 'MuSig2 starts in round 1 — nonce collection');
assert.equal(validateMultisigSigningSession(musig2).ok, true, 'MuSig2 session validates');

// progressSummary uses dual-mode labels.
assert.equal(
    progressSummary(p2wsh).label,
    'Signatures collected',
    'P2SH/P2WSH tracker label is "Signatures collected"',
);
assert.equal(
    progressSummary(musig2).label,
    'Nonces collected',
    'MuSig2 round 1 tracker label is "Nonces collected"',
);
assert.equal(
    progressSummary({ ...musig2, status: 'collecting-sigs' }).label,
    'Partial sigs collected',
    'MuSig2 round 2 tracker label is "Partial sigs collected"',
);

// pendingCosignerPubkeys initially returns all cosigners.
assert.deepEqual(
    pendingCosignerPubkeys(p2wsh).sort(),
    [alicePk, bobPk, carolPk].sort(),
    'P2WSH pending list starts with every cosigner',
);
assert.deepEqual(
    pendingCosignerPubkeys(musig2).sort(),
    [alicePk, bobPk].sort(),
    'MuSig2 pending nonces start with every cosigner',
);

// Threshold > N rejected.
assert.throws(
    () => createMultisigSigningSession(sample({
        scheme: 'p2wsh-multisig',
        threshold: 3,
        cosignerPubkeys: [alicePk, bobPk],
    })),
    /threshold must be ≤ cosignerPubkeys.length/,
);

// Bad msgHash rejected.
assert.throws(
    () => createMultisigSigningSession(sample({
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosignerPubkeys: [alicePk, bobPk],
        msgHash: 'short',
    })),
    /msgHash must be 32-byte hex/,
);

// ─── Flow re-exports + guards ────────────────────────────────────

for (const name of [
    'startMultisigSigningSession',
    'getMultisigSigningSession',
    'listMultisigSigningSessions',
    'cancelMultisigSigningSession',
    'contributeMultisigNonce',
    'contributeMultisigSignature',
    'aggregateMultisigSession',
    'finalizeMultisigSigningSession',
]) {
    assert.equal(typeof flows[name], 'function', `flows.${name} is re-exported`);
}

await assert.rejects(
    async () => flows.startMultisigSigningSession({}),
    /vault is required/,
);
await assert.rejects(
    async () => flows.startMultisigSigningSession({ vault: {}, walletId: 'w' }),
    /chainId is required/,
);
await assert.rejects(
    async () => flows.startMultisigSigningSession({
        vault: {}, walletId: 'w', chainId: 'bitcoin-mainnet', msgHash: 'short',
    }),
    /msgHash must be 32-byte hex/,
);

// ─── State-machine drive against a fake vault + SDK ──────────────

function makeFakeVault({ wallet }) {
    /** @type {Map<string, any>} */
    const sessions = new Map();
    return {
        wallets: {
            async get(id) { return id === wallet?.id ? wallet : null; },
        },
        multisigSigningSessions: {
            async get(id) { return sessions.get(id) || null; },
            async list() { return Array.from(sessions.values()); },
            async put(record) {
                // Mirror Vault.makeCollection's validate pass.
                const r = validateMultisigSigningSession(record);
                if (!r.ok) {
                    throw new Error(
                        `fake-vault: invalid multisigSigningSession — ${r.errors.join('; ')}`,
                    );
                }
                sessions.set(record.id, record);
            },
        },
    };
}

// P2WSH: 2-of-3 single-round flow.
{
    const wallet = {
        id: 'w-p2wsh',
        multisigs: [{
            id: 'cfg-p2wsh',
            scheme: 'p2wsh-multisig',
            threshold: 2,
            scriptTemplate: `multi:2:${alicePk}:${bobPk}:${carolPk}`,
            cosigners: [
                { pubkey: alicePk },
                { pubkey: bobPk },
                { pubkey: carolPk },
            ],
        }],
    };
    const vault = makeFakeVault({ wallet });

    const session = await flows.startMultisigSigningSession({
        vault,
        walletId: 'w-p2wsh',
        chainId: 'bitcoin-mainnet',
        msgHash: 'cd'.repeat(32),
        psbtHex: '',
        actionSummary: 'send 0.5 BTC',
    });
    assert.equal(session.scheme, 'p2wsh-multisig');
    assert.equal(session.status, 'collecting-sigs');
    assert.equal(session.cosignerPubkeys.length, 3);

    // First contribution.
    const afterAlice = await flows.contributeMultisigSignature({
        vault,
        sessionId: session.id,
        pubkey: alicePk,
        signatureHex: '30' + '44'.repeat(35) + '01', // length checks only
    });
    assert.equal(afterAlice.signatures.length, 1);
    assert.equal(afterAlice.status, 'collecting-sigs');

    // Duplicate cosigner blocked.
    await assert.rejects(
        async () => flows.contributeMultisigSignature({
            vault,
            sessionId: session.id,
            pubkey: alicePk,
            signatureHex: '30' + '44'.repeat(35) + '01',
        }),
        /already contributed/,
    );

    // Threshold-meeting contribution flips status to ready-to-finalize.
    const afterBob = await flows.contributeMultisigSignature({
        vault,
        sessionId: session.id,
        pubkey: bobPk,
        signatureHex: '30' + '45'.repeat(35) + '01',
    });
    assert.equal(afterBob.signatures.length, 2);
    assert.equal(afterBob.status, 'ready-to-finalize');

    // Finalize stub.
    const finalized = await flows.finalizeMultisigSigningSession({
        vault,
        sessionId: session.id,
        finalizedTxHex: '0200000001abcd',
        txid: '0xtxid',
    });
    assert.equal(finalized.status, 'finalized');
    assert.equal(finalized.finalizedTxHex, '0200000001abcd');
    assert.equal(finalized.txid, '0xtxid');

    // listMultisigSigningSessions filters by walletId.
    const list = await flows.listMultisigSigningSessions({ vault, walletId: 'w-p2wsh' });
    assert.equal(list.length, 1);
}

// MuSig2: 2-of-2 two-round flow drive against a stubbed SDK.
{
    const wallet = {
        id: 'w-musig2',
        multisigs: [{
            id: 'cfg-musig2',
            scheme: 'taproot-musig2',
            threshold: 2,
            scriptTemplate: 'musig2:' + 'cd'.repeat(32),
            cosigners: [
                { pubkey: alicePk },
                { pubkey: bobPk },
            ],
        }],
    };
    const vault = makeFakeVault({ wallet });

    /** @type {string[]} */
    const aggregateNonceCalls = [];
    /** @type {string[][]} */
    const aggregateSigCalls = [];
    const sdkRegistry = {
        get(_chainId) {
            return {
                musig2: {
                    aggregateNonces(nonces) {
                        aggregateNonceCalls.push(nonces.length);
                        return new Uint8Array(66).fill(0xab);
                    },
                    startSession(aggNonce, msg, keys) {
                        return { aggNonce, msg, keys, _stub: true };
                    },
                    aggregateSignatures(sigs, sessionKey) {
                        aggregateSigCalls.push(sigs.map((s) => s.length));
                        assert.ok(sessionKey?._stub, 'aggregateSignatures receives the stubbed sessionKey');
                        return new Uint8Array(64).fill(0xcd);
                    },
                },
            };
        },
    };

    const session = await flows.startMultisigSigningSession({
        vault,
        walletId: 'w-musig2',
        chainId: 'bitcoin-mainnet',
        msgHash: 'aa'.repeat(32),
        psbtHex: '',
        actionSummary: 'send 0.1 BTC',
    });
    assert.equal(session.status, 'collecting-nonces');

    // Round 1 contributions (66-byte hex == 132 chars).
    const nonceA = '11'.repeat(66);
    const nonceB = '22'.repeat(66);
    const afterAliceNonce = await flows.contributeMultisigNonce({
        vault,
        sessionId: session.id,
        pubkey: alicePk,
        publicNonceHex: nonceA,
    });
    assert.equal(afterAliceNonce.nonces.length, 1);

    // Wrong-length nonce rejected.
    await assert.rejects(
        async () => flows.contributeMultisigNonce({
            vault,
            sessionId: session.id,
            pubkey: bobPk,
            publicNonceHex: '11',
        }),
        /publicNonceHex must be 66-byte hex/,
    );

    // Wrong scheme: signatures on the MuSig2 session before round 1 closes.
    await assert.rejects(
        async () => flows.contributeMultisigSignature({
            vault,
            sessionId: session.id,
            pubkey: alicePk,
            signatureHex: 'aa'.repeat(32),
        }),
        /status "collecting-nonces"/,
    );

    const afterBobNonce = await flows.contributeMultisigNonce({
        vault,
        sessionId: session.id,
        pubkey: bobPk,
        publicNonceHex: nonceB,
    });
    assert.equal(afterBobNonce.nonces.length, 2);
    assert.equal(afterBobNonce.status, 'collecting-nonces',
        'session does not auto-advance — caller drives aggregateMultisigSession');

    const afterRound1Agg = await flows.aggregateMultisigSession({
        vault,
        sdkRegistry,
        sessionId: session.id,
    });
    assert.equal(afterRound1Agg.status, 'collecting-sigs',
        'aggregate transitions round 1 → round 2');
    assert.equal(afterRound1Agg.aggNonce, 'ab'.repeat(66),
        'aggNonce is persisted as hex of the SDK output');
    assert.equal(aggregateNonceCalls[0], 2,
        'aggregateNonces is called with threshold many nonces');

    // Wrong shape on partial sig.
    await assert.rejects(
        async () => flows.contributeMultisigSignature({
            vault,
            sessionId: session.id,
            pubkey: alicePk,
            signatureHex: 'aa', // too short
        }),
        /MuSig2 partial sig must be 32-byte/,
    );

    const partialA = '11'.repeat(32);
    const partialB = '22'.repeat(32);
    await flows.contributeMultisigSignature({
        vault,
        sessionId: session.id,
        pubkey: alicePk,
        signatureHex: partialA,
    });
    const afterBobPartial = await flows.contributeMultisigSignature({
        vault,
        sessionId: session.id,
        pubkey: bobPk,
        signatureHex: partialB,
    });
    assert.equal(afterBobPartial.partialSigs.length, 2);
    assert.equal(afterBobPartial.status, 'collecting-sigs',
        'partial sigs do NOT auto-aggregate — caller drives aggregateMultisigSession');

    const afterRound2Agg = await flows.aggregateMultisigSession({
        vault,
        sdkRegistry,
        sessionId: session.id,
    });
    assert.equal(afterRound2Agg.status, 'ready-to-finalize',
        'round 2 aggregation flips status to ready-to-finalize');
    assert.equal(afterRound2Agg.aggregatedSchnorrSig, 'cd'.repeat(64),
        'aggregatedSchnorrSig is persisted as hex of the 64-byte SDK output');
    assert.equal(aggregateSigCalls[0].length, 2,
        'aggregateSignatures receives threshold many partials');

    // Cancel after success is a no-op (cancelled is for in-flight sessions).
    const cancelled = await flows.cancelMultisigSigningSession({
        vault,
        sessionId: session.id,
    });
    assert.equal(cancelled.status, 'cancelled');

    // Once cancelled, contributions are blocked.
    await assert.rejects(
        async () => flows.contributeMultisigSignature({
            vault,
            sessionId: session.id,
            pubkey: alicePk,
            signatureHex: 'aa'.repeat(32),
        }),
        /status "cancelled"/,
    );
}

// ─── Background host ─────────────────────────────────────────────

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of [
    'multisigSign.start',
    'multisigSign.get',
    'multisigSign.list',
    'multisigSign.cancel',
    'multisigSign.contributeNonce',
    'multisigSign.contributeSignature',
    'multisigSign.aggregate',
    'multisigSign.finalize',
]) {
    assert.ok(bg.includes(`'${route}'`),
        `background host registers ${route}`);
}
assert.ok(/startMultisigSigningSession\b/.test(bg),
    'background host imports startMultisigSigningSession');

// ─── Shell messaging helpers (3 shells) ──────────────────────────

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of [
        'startMultisigSigningSession',
        'getMultisigSigningSession',
        'listMultisigSigningSessions',
        'cancelMultisigSigningSession',
        'contributeMultisigNonce',
        'contributeMultisigSignature',
        'aggregateMultisigSession',
        'finalizeMultisigSigningSession',
    ]) {
        assert.ok(new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`);
    }
}

// ─── Sign-screen route ───────────────────────────────────────────

const routePath = join(sharedRoutes, 'MultisigSigningSession.jsx');
assert.ok(existsSync(routePath), 'MultisigSigningSession.jsx exists');
const route = readFileSync(routePath, 'utf8');
assert.ok(/export function MultisigSigningSession\b/.test(route),
    'MultisigSigningSession is a named export');
assert.ok(/Signatures collected/.test(route),
    'route renders the P2SH/P2WSH single-round tracker copy');
assert.ok(/Nonces collected/.test(route),
    'route renders the MuSig2 round-1 tracker copy');
assert.ok(/Partial sigs collected/.test(route),
    'route renders the MuSig2 round-2 tracker copy');
assert.ok(/aggregateMultisigSession|messaging\.aggregateMultisigSession/.test(route),
    'route drives aggregateMultisigSession');
assert.ok(/cancelMultisigSigningSession|messaging\.cancelMultisigSigningSession/.test(route),
    'route exposes a cancel action');
assert.ok(/Pending cosigners/.test(route),
    'route surfaces pending cosigners');

// ─── App.jsx wiring (all three shells) ───────────────────────────

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('MultisigSigningSession'),
        `${shell} App.jsx imports MultisigSigningSession`);
    assert.ok(app.includes("'multisig-sign'"),
        `${shell} tracks 'multisig-sign' sub-route`);
    assert.ok(/onMultisigSign: hasBtcAddress \? \(\) => setUnlockedView\('multisig-sign'\)/.test(app),
        `${shell} BTC-gates onMultisigSign via hasBtcAddress`);
    assert.ok(/<MultisigSigningSession\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <MultisigSigningSession> with the active walletId`);
    assert.ok(/Multisig signing/.test(app),
        `${shell} ActionsMenu surfaces a "Multisig signing" entry`);
}

// ─── SDK pin ≥ 1.11.0 (Step 19 needed no bump; later steps may have) ─

for (const [shell, pkgPath] of [
    ['extension', join(ext, 'package.json')],
    ['web', join(web, 'package.json')],
]) {
    const pkg = readFileSync(pkgPath, 'utf8');
    assert.ok(/"xchain-sdk":\s*"(?:link:|\^1\.(?:1[1-9]|[2-9]\d)\.0)/.test(pkg),
        `${shell} pkg pins xchain-sdk ≥ ^1.11.0 or uses link: for sibling-repo dev`);
}

console.log(
    'OK — multisig signing smoke (schema state machine + dual-mode tracker labels + threshold+msgHash guards + flow re-exports + P2WSH single-round end-to-end + MuSig2 two-round drive + duplicate-cosigner guard + status-gated contribution + cancel terminal state + bg handler 8 routes + 3-shell messaging exports + MultisigSigningSession route renders dual-mode tracker copy + 3-shell App.jsx wiring + BTC gate + SDK pin unchanged)',
);
