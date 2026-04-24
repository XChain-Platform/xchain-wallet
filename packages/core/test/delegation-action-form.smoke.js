// Smoke for Phase 4 — Step 10 of 23 — DELEGATE + REVOKE_DELEGATION
// forms (§42.7.2 delegation-lane).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'DelegationActionForm.jsx');
assert.ok(existsSync(formPath), 'DelegationActionForm.jsx exists');
const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function DelegationActionForm\b/.test(formSrc),
    'DelegationActionForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'DelegationActionForm.jsx only exports the component',
);

// Mode prop + branching.
assert.ok(/mode\s*===\s*['"]delegate['"]/.test(formSrc),
    'DelegationActionForm branches on mode === delegate');
assert.ok(/Delegate|Revoke/.test(formSrc),
    'DelegationActionForm renders both verbs');

// 4-stage state machine.
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `DelegationActionForm tracks '${stage}' stage`);
}

// Pubkey validation — 64 hex chars.
assert.ok(/\[0-9a-fA-F\]\{64\}/.test(formSrc),
    'DelegationActionForm validates signing pubkey as 64 hex chars');

// Revoke mode pre-populates from getDelegationsForAddress.
assert.ok(/messaging\.getDelegationsForAddress/.test(formSrc),
    'DelegationActionForm queries getDelegationsForAddress in revoke mode for pre-fill');

// Wiring of all four messaging helpers + shared chassis.
for (const call of [
    'messaging.delegateAction',
    'messaging.delegateActionHw',
    'messaging.revokeDelegationAction',
    'messaging.revokeDelegationActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `DelegationActionForm calls ${call}`);
}

// Wrong-password handling.
assert.ok(/InvalidPasswordError/.test(formSrc),
    'DelegationActionForm distinguishes wrong-password');

// --- Core flow guards ---

assert.equal(typeof flows.delegateAction, 'function', 'flows.delegateAction re-exported');
assert.equal(typeof flows.revokeDelegationAction, 'function',
    'flows.revokeDelegationAction re-exported');

await assert.rejects(
    async () => flows.delegateAction({}),
    /delegateAction: params is required/,
    'delegateAction guards params',
);
await assert.rejects(
    async () => flows.delegateAction({ params: {} }),
    /delegateAction: params\.NEW_SIGNING_PUBKEY is required/,
    'delegateAction guards NEW_SIGNING_PUBKEY',
);
await assert.rejects(
    async () => flows.delegateAction({ params: { NEW_SIGNING_PUBKEY: 'not-hex' } }),
    /NEW_SIGNING_PUBKEY must be 64 hex chars/,
    'delegateAction validates NEW_SIGNING_PUBKEY format',
);

await assert.rejects(
    async () => flows.revokeDelegationAction({}),
    /revokeDelegationAction: params is required/,
    'revokeDelegationAction guards params',
);
await assert.rejects(
    async () => flows.revokeDelegationAction({ params: {} }),
    /revokeDelegationAction: params\.SIGNING_PUBKEY is required/,
    'revokeDelegationAction guards SIGNING_PUBKEY',
);
await assert.rejects(
    async () => flows.revokeDelegationAction({ params: { SIGNING_PUBKEY: 'not-hex' } }),
    /SIGNING_PUBKEY must be 64 hex chars/,
    'revokeDelegationAction validates SIGNING_PUBKEY format',
);

// --- Background host + shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const h of ["'action.delegate'", "'action.revokeDelegation'"]) {
    assert.ok(bg.includes(h), `background host registers ${h}`);
}
assert.ok(/registerHwHandler\('action\.delegate\.hw', delegateAction\)/.test(bg),
    'background host registers action.delegate.hw');
assert.ok(/registerHwHandler\('action\.revokeDelegation\.hw', revokeDelegationAction\)/.test(bg),
    'background host registers action.revokeDelegation.hw');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['delegateAction', 'delegateActionHw', 'revokeDelegationAction', 'revokeDelegationActionHw']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
}

// --- App.jsx wiring ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('DelegationActionForm'),
        `${shell} App.jsx imports DelegationActionForm`);
    assert.ok(app.includes("'staking-delegate'"),
        `${shell} tracks staking-delegate sub-route`);
    assert.ok(app.includes("'staking-revoke'"),
        `${shell} tracks staking-revoke sub-route`);
    assert.ok(/onDelegate=\{\(ref\)\s*=>\s*\{\s*setStakingRef\(ref\);\s*setUnlockedView\('staking-delegate'\)/.test(app),
        `${shell} wires StakingDashboard.onDelegate → staking-delegate with ref`);
    assert.ok(/onRevokeDelegation=\{\(ref\)\s*=>\s*\{\s*setStakingRef\(ref\);\s*setUnlockedView\('staking-revoke'\)/.test(app),
        `${shell} wires StakingDashboard.onRevokeDelegation → staking-revoke with ref`);
    assert.ok(/mode="delegate"/.test(app),
        `${shell} App.jsx passes mode="delegate" to DelegationActionForm for the delegate route`);
    assert.ok(/mode="revoke"/.test(app),
        `${shell} App.jsx passes mode="revoke" to DelegationActionForm for the revoke route`);
}

console.log(
    'OK — delegation action form smoke (DelegationActionForm mode=delegate|revoke + delegateAction/revokeDelegationAction flows with 64-hex Ed25519 validation + revoke auto-prefill via getDelegationsForAddress + bg handlers + 3-shell messaging + two App.jsx sub-routes wired from StakingDashboard)',
);
