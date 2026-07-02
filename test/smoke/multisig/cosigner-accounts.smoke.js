// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §22 / P4 passive co-signer management UI (slice 4): the in-wallet
// surface to create + manage agent accounts. Mirrors multisig-create.smoke.js:
// core-flow guards + background handler + 3-shell messaging exports + route
// files + 3-shell App.jsx wiring, so the whole chain stays connected.

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- Core flows re-exported + guarded ---

for (const fn of ['provisionCoSignerAccount', 'listCoSignerAccounts', 'getCoSignerAccount', 'updateCoSignerAccount']) {
    assert.equal(typeof flows[fn], 'function', `flows.${fn} re-exported`);
}

await assert.rejects(async () => flows.provisionCoSignerAccount({}), /vault is required/,
    'provisionCoSignerAccount guards vault');
await assert.rejects(
    async () => flows.provisionCoSignerAccount({ vault: { coSignerAccounts: {} } }),
    /sdkRegistry is required/,
    'provisionCoSignerAccount guards sdkRegistry',
);
await assert.rejects(async () => flows.updateCoSignerAccount({}), /vault is required/,
    'updateCoSignerAccount guards vault');
await assert.rejects(
    async () => flows.updateCoSignerAccount({ vault: { coSignerAccounts: {} } }),
    /id is required/,
    'updateCoSignerAccount guards id',
);
await assert.rejects(async () => flows.listCoSignerAccounts({}), /vault is required/,
    'listCoSignerAccounts guards vault');
await assert.rejects(async () => flows.getCoSignerAccount({}), /vault is required/,
    'getCoSignerAccount guards vault');

// A missing account surfaces the typed not-found error, not a generic throw.
const fakeVault = { coSignerAccounts: { async get() { return null; } } };
await assert.rejects(
    async () => flows.updateCoSignerAccount({ vault: fakeVault, id: 'nope' }),
    /not found/,
    'updateCoSignerAccount rejects an unknown id',
);

// --- Background host registrations ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of ['coSigner.provision', 'coSigner.list', 'coSigner.get', 'coSigner.update']) {
    assert.ok(bg.includes(`'${route}'`), `background host registers ${route}`);
}
assert.ok(/flows\.provisionCoSignerAccount\b/.test(bg), 'bg host calls flows.provisionCoSignerAccount');
assert.ok(/flows\.updateCoSignerAccount\b/.test(bg), 'bg host calls flows.updateCoSignerAccount');

// --- 3-shell messaging exports ---

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['provisionCoSignerAccount', 'listCoSignerAccounts', 'getCoSignerAccount', 'updateCoSignerAccount']) {
        assert.ok(new RegExp(`export function ${fn}\\b`).test(m), `${shell} messaging.js exports ${fn}`);
    }
    assert.ok(m.includes("'coSigner.provision'"), `${shell} messaging.js sends coSigner.provision`);
}

// --- Route files ---

for (const [file, named] of [
    ['CoSignerProvision.jsx', 'CoSignerProvision'],
    ['CoSignerAccountList.jsx', 'CoSignerAccountList'],
    ['CoSignerAccountDetail.jsx', 'CoSignerAccountDetail'],
    ['CoSignerPolicyEditor.jsx', 'CoSignerPolicyEditor'],
]) {
    const p = join(sharedRoutes, file);
    assert.ok(existsSync(p), `${file} exists`);
    const src = readFileSync(p, 'utf8');
    assert.ok(new RegExp(`export function ${named}\\b`).test(src), `${file} named-exports ${named}`);
}

const provisionSrc = readFileSync(join(sharedRoutes, 'CoSignerProvision.jsx'), 'utf8');
assert.ok(/messaging\.provisionCoSignerAccount/.test(provisionSrc),
    'CoSignerProvision calls messaging.provisionCoSignerAccount');
assert.ok(/Bitcoin-only|Bitcoin only/.test(provisionSrc),
    'CoSignerProvision states the BTC-only constraint');

const detailSrc = readFileSync(join(sharedRoutes, 'CoSignerAccountDetail.jsx'), 'utf8');
assert.ok(/messaging\.updateCoSignerAccount/.test(detailSrc),
    'CoSignerAccountDetail calls messaging.updateCoSignerAccount for the enable/disable toggle');

// --- 3-shell App.jsx wiring ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('CoSignerAccountList'), `${shell} App.jsx imports CoSignerAccountList`);
    assert.ok(app.includes('CoSignerProvision'), `${shell} App.jsx imports CoSignerProvision`);
    assert.ok(app.includes('CoSignerAccountDetail'), `${shell} App.jsx imports CoSignerAccountDetail`);
    assert.ok(app.includes("'cosigner-accounts'"), `${shell} tracks 'cosigner-accounts' sub-route`);
    assert.ok(app.includes("'cosigner-provision'"), `${shell} tracks 'cosigner-provision' sub-route`);
    assert.ok(app.includes("'cosigner-detail'"), `${shell} tracks 'cosigner-detail' sub-route`);
    assert.ok(
        /onCoSignerAccounts: hasBtcAddress \? \(\) => setUnlockedView\('cosigner-accounts'\)/.test(app),
        `${shell} BTC-gates onCoSignerAccounts via hasBtcAddress`,
    );
    assert.ok(/id: 'cosigner-accounts'/.test(app), `${shell} surfaces the "Agent accounts" action entry`);
}

console.log(
    'OK: co-signer management smoke (core-flow guards + not-found error + coSigner.* bg handlers + 3-shell messaging exports + provision/list/detail/policy-editor routes + BTC-only copy + enable-disable toggle wiring + 3-shell App.jsx sub-routes + BTC-gated Agent-accounts entry)',
);
