// Smoke for Phase 4 — Step 17 of 23 — Multisig wallet creation
// coordinator (§22 + §42.9).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildMultisigConfig,
    validateMultisigConfig,
    MULTISIG_SCHEMES,
    COSIGNER_ORIGINS,
} from '../src/schemas/multisigConfig.js';
import { flows } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- Schema ---

assert.deepEqual(
    [...MULTISIG_SCHEMES],
    ['p2sh-multisig', 'p2wsh-multisig', 'taproot-musig2'],
    'MULTISIG_SCHEMES carries all three Phase 4 schemes',
);
assert.deepEqual(
    [...COSIGNER_ORIGINS],
    ['local', 'external-xpub', 'external-hardware'],
    'COSIGNER_ORIGINS matches §22.2',
);

// validateMultisigConfig rejects malformed records.
assert.equal(validateMultisigConfig(null).ok, false, 'rejects null');
assert.equal(validateMultisigConfig({}).ok, false, 'rejects empty object');

// buildMultisigConfig — happy path for P2WSH.
const cosignerA = {
    name: 'Alice',
    pubkey: '02'.padEnd(66, 'a'),
    fingerprint: 'aabbccdd',
    origin: 'local',
    localSignerId: 'wallet:abc',
    xpub: null,
    derivationPath: "m/48'/0'/0'/2'/0/0",
};
const cosignerB = {
    name: 'Bob',
    pubkey: '03'.padEnd(66, 'b'),
    fingerprint: '11223344',
    origin: 'external-xpub',
    localSignerId: null,
    xpub: 'xpub6CUGRUonZSQ4F1234',
    derivationPath: "m/48'/0'/0'/2'/0/0",
};
const cfgPwsh = buildMultisigConfig({
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosigners: [cosignerA, cosignerB],
});
assert.equal(cfgPwsh.scheme, 'p2wsh-multisig');
assert.equal(cfgPwsh.threshold, 2);
assert.equal(cfgPwsh.cosigners.length, 2);
assert.ok(/^multi:2:/.test(cfgPwsh.scriptTemplate),
    'P2WSH scriptTemplate is "multi:<T>:<pk1>:<pk2>:..."');
assert.ok(cfgPwsh.scriptTemplate.includes(cosignerA.pubkey.toLowerCase()));
assert.ok(cfgPwsh.scriptTemplate.includes(cosignerB.pubkey.toLowerCase()));
assert.ok(cfgPwsh.cosigners.every((c) => typeof c.addedAt === 'string' && c.addedAt.length > 0),
    'each cosigner gets an ISO addedAt');

// Taproot-MuSig2 requires aggregatedXOnlyPubkey.
assert.throws(
    () => buildMultisigConfig({
        scheme: 'taproot-musig2',
        threshold: 2,
        cosigners: [cosignerA, cosignerB],
    }),
    /aggregatedXOnlyPubkey/,
    'taproot-musig2 without aggregated pubkey throws',
);
const cfgMusig2 = buildMultisigConfig({
    scheme: 'taproot-musig2',
    threshold: 2,
    cosigners: [cosignerA, cosignerB],
    aggregatedXOnlyPubkey: 'cd'.padEnd(64, 'c'),
});
assert.ok(cfgMusig2.scriptTemplate.startsWith('musig2:'),
    'taproot-musig2 scriptTemplate is "musig2:<aggXOnly>"');

// Threshold > N rejected.
assert.throws(
    () => buildMultisigConfig({
        scheme: 'p2wsh-multisig',
        threshold: 3,
        cosigners: [cosignerA, cosignerB],
    }),
    /threshold must be ≤ cosigners.length/,
);

// Duplicate pubkeys rejected by validator.
const cfgDup = {
    schemaVersion: 1,
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosigners: [
        { ...cosignerA, addedAt: new Date().toISOString() },
        { ...cosignerB, pubkey: cosignerA.pubkey, addedAt: new Date().toISOString() },
    ],
    scriptTemplate: `multi:2:${cosignerA.pubkey}:${cosignerA.pubkey}`,
};
assert.equal(validateMultisigConfig(cfgDup).ok, false,
    'validator catches duplicate pubkeys');

// --- Core flow guards ---

assert.equal(typeof flows.createMultisigConfig, 'function',
    'flows.createMultisigConfig re-exported');
await assert.rejects(
    async () => flows.createMultisigConfig({}),
    /vault is required/,
    'createMultisigConfig guards vault',
);
await assert.rejects(
    async () => flows.createMultisigConfig({ vault: {}, sdkRegistry: {} }),
    /chainId is required/,
);
await assert.rejects(
    async () => flows.createMultisigConfig({
        vault: {}, sdkRegistry: {}, chainId: 'bitcoin-mainnet',
    }),
    /walletId is required/,
);
await assert.rejects(
    async () => flows.createMultisigConfig({
        vault: {}, sdkRegistry: {}, chainId: 'x', walletId: 'w',
        scheme: 'p2wsh-multisig', threshold: 1, cosigners: [cosignerA],
    }),
    /at least 2 entries/,
    'createMultisigConfig requires ≥2 cosigners',
);

// --- Background host + shell messaging ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'multisig.create'"),
    'background host registers multisig.create');
assert.ok(/createMultisigConfig\b/.test(bg),
    'background host imports createMultisigConfig');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function createMultisigConfig\b/.test(m),
        `${shell} messaging.js exports createMultisigConfig`);
    // Belt-and-suspenders: each helper appears exactly once (no
    // duplicate exports).
    const matches = m.match(/export function getActionByIndex\b/g) || [];
    assert.equal(matches.length, 1,
        `${shell} messaging.js exports getActionByIndex exactly once`);
}

// --- Route ---

const routePath = join(sharedRoutes, 'MultisigCreate.jsx');
assert.ok(existsSync(routePath), 'MultisigCreate.jsx exists');
const route = readFileSync(routePath, 'utf8');
assert.ok(/export function MultisigCreate\b/.test(route),
    'MultisigCreate is a named export');
for (const scheme of MULTISIG_SCHEMES) {
    assert.ok(route.includes(scheme),
        `MultisigCreate offers the ${scheme} scheme option`);
}
assert.ok(/messaging.createMultisigConfig/.test(route),
    'MultisigCreate calls messaging.createMultisigConfig');
assert.ok(/Bitcoin-only/.test(route),
    'MultisigCreate states the BTC-only constraint');

// --- App.jsx wiring (all three shells) ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('MultisigCreate'),
        `${shell} App.jsx imports MultisigCreate`);
    assert.ok(app.includes("'multisig-create'"),
        `${shell} tracks 'multisig-create' sub-route`);
    assert.ok(/onMultisigCreate: hasBtcAddress \? \(\) => setUnlockedView\('multisig-create'\)/.test(app),
        `${shell} ActionsMenu BTC-gates onMultisigCreate via hasBtcAddress`);
    assert.ok(/<MultisigCreate\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <MultisigCreate> with the active walletId`);
    assert.ok(/Create multisig/.test(app),
        `${shell} ActionsMenu surfaces the "Create multisig" entry`);
}

console.log(
    'OK — multisig create smoke (schema + buildMultisigConfig + duplicate-pubkey guard + threshold > N guard + taproot-musig2 aggregated pubkey requirement + createMultisigConfig core flow guards + bg handler + 3-shell messaging exports + getActionByIndex de-duplication + MultisigCreate route with all three schemes + 3-shell App.jsx + ActionsMenu BTC gate)',
);
