// Smoke for Phase 4 — Step 8 of 23 — STAKE authoring form (§42.7.1).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const platformRoot = join(wsRoot, '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'StakeForm.jsx');
assert.ok(existsSync(formPath), 'StakeForm.jsx exists');
const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function StakeForm\b/.test(formSrc), 'StakeForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'StakeForm.jsx only exports the component',
);

// 4-stage state machine
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `StakeForm tracks '${stage}' stage`);
}

// Tier 1/2 radios present
assert.ok(/Tier 1 .* Oracle/.test(formSrc), 'StakeForm renders Tier 1 option');
assert.ok(/Tier 2 .* Cross-chain validator/.test(formSrc), 'StakeForm renders Tier 2 option');
// Tier 3 intentionally NOT exposed as a user-selectable radio option
// (SDK format limitation, deferred). A Tier 3 label is still kept in
// the tier-label lookup for dashboard rendering of externally-created
// Tier 3 stakes — the gate is on the radio inputs only.
assert.ok(!/value="3"/.test(formSrc),
    'StakeForm does not offer Tier 3 as a selectable radio input (deferred — SDK format limitation)');
// Chains only when Tier 2
assert.ok(/tier === '2' \?/.test(formSrc) || /tier === '2'\s*\?/.test(formSrc),
    'StakeForm conditionally renders Chains fieldset on Tier 2');

// Pubkey validation — 64 hex chars
assert.ok(/\[0-9a-fA-F\]\{64\}/.test(formSrc),
    'StakeForm validates signing pubkey as 64 hex chars');

// Wiring
for (const call of [
    'messaging.stakeAction',
    'messaging.stakeActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `StakeForm calls ${call}`);
}
// §20 Cluster X Step 13 — handler refactored from a ternary into an if/
// else cascade (watcher-mode branch wins first). Pin the HW branch
// against either the legacy ternary OR the new cascade shape.
assert.ok(
    /isHwSource\s*\n?\s*\?\s*await messaging\.stakeActionHw/.test(formSrc)
        || /else if \(isHwSource\) \{[\s\S]+?messaging\.stakeActionHw/.test(formSrc),
    'StakeForm branches HW vs software signing',
);
assert.ok(/InvalidPasswordError/.test(formSrc),
    'StakeForm distinguishes wrong-password');

// 6-block activation delay messaging
assert.ok(/6 BTC blocks/.test(formSrc),
    'StakeForm mentions the 6-BTC-block activation delay per STAKE.md');

// --- Core flow guards ---

assert.equal(typeof flows.stakeAction, 'function', 'flows.stakeAction re-exported');

await assert.rejects(
    async () => flows.stakeAction({}),
    /stakeAction: params is required/,
    'stakeAction guards params',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { SIGNING_PUBKEY: 'a'.repeat(64) } }),
    /stakeAction: params\.TIER is required/,
    'stakeAction guards TIER',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { TIER: '1' } }),
    /stakeAction: params\.SIGNING_PUBKEY is required/,
    'stakeAction guards SIGNING_PUBKEY',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { TIER: '1', SIGNING_PUBKEY: 'not-hex' } }),
    /SIGNING_PUBKEY must be 64 hex chars/,
    'stakeAction validates SIGNING_PUBKEY format',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { TIER: '2', SIGNING_PUBKEY: 'a'.repeat(64) } }),
    /CHAINS is required for Tier 2/,
    'stakeAction requires CHAINS for Tier 2',
);

// --- Background host + 3-shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'action.stake'"), 'background host registers action.stake');
assert.ok(/registerHwHandler\('action\.stake\.hw', stakeAction\)/.test(bg),
    'background host registers action.stake.hw via registerHwHandler');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['stakeAction', 'stakeActionHw']) {
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
    assert.ok(app.includes('StakeForm'), `${shell} App.jsx imports StakeForm`);
    assert.ok(app.includes("'stake-form'"), `${shell} tracks stake-form sub-route`);
    assert.ok(/stakingRef,\s*setStakingRef/.test(app),
        `${shell} declares stakingRef state`);
    assert.ok(/onStake=\{\(ref\)\s*=>\s*\{\s*setStakingRef\(ref\);\s*setUnlockedView\('stake-form'\)/.test(app),
        `${shell} wires StakingDashboard.onStake → stake-form with ref`);
}

// --- Followups note exists ---

const followupsPath = join(platformRoot, 'claude', 'reports', 'specs', '2026-04-24_phase4-staking-followups.md');
assert.ok(existsSync(followupsPath),
    'Staking followups captured at claude/reports/specs/2026-04-24_phase4-staking-followups.md');

console.log(
    'OK — stake form smoke (StakeForm Tier 1+2 with pubkey validation + chains multi-select + bg handler + 3-shell messaging + dashboard onStake wire-through + followups file with Tier 3 deferral)',
);
