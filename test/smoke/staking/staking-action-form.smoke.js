// Smoke for Phase 4 — Step 9 of 23 — UNSTAKE + CLAIM_REWARDS forms
// (§42.7.2 unstake-lane + §42.7.3).

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

const formPath = join(sharedRoutes, 'StakingActionForm.jsx');
assert.ok(existsSync(formPath), 'StakingActionForm.jsx exists');
const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function StakingActionForm\b/.test(formSrc),
    'StakingActionForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'StakingActionForm.jsx only exports the component',
);

// Mode prop + branching.
assert.ok(/mode\s*===\s*['"]unstake['"]/.test(formSrc),
    'StakingActionForm branches on mode === unstake');
assert.ok(/Unstake|Claim rewards/.test(formSrc),
    'StakingActionForm renders both verbs');

// 4-stage state machine.
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `StakingActionForm tracks '${stage}' stage`);
}

// Unstake tier picker (Tier 1 / Tier 2 — Tier 3 deferred, same as StakeForm)
assert.ok(/Tier 1 .* Oracle/.test(formSrc),
    'StakingActionForm renders Tier 1 option for unstake');
assert.ok(/Tier 2 .* Cross-chain validator/.test(formSrc),
    'StakingActionForm renders Tier 2 option for unstake');
assert.ok(!/value="3"/.test(formSrc),
    'StakingActionForm does not offer Tier 3 as a selectable radio input');

// Protocol-correct copy: full-tier unstake, no partial amount.
assert.ok(/full tier stake|full tier amount/.test(formSrc),
    'StakingActionForm explains unstake returns the full tier stake (not a partial amount)');

// Wiring of all four messaging helpers + shared chassis.
for (const call of [
    'messaging.unstakeAction',
    'messaging.unstakeActionHw',
    'messaging.claimRewardsAction',
    'messaging.claimRewardsActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `StakingActionForm calls ${call}`);
}

// Wrong-password handling.
assert.ok(/InvalidPasswordError/.test(formSrc),
    'StakingActionForm distinguishes wrong-password');

// --- Core flow guards ---

assert.equal(typeof flows.unstakeAction, 'function', 'flows.unstakeAction re-exported');
assert.equal(typeof flows.claimRewardsAction, 'function', 'flows.claimRewardsAction re-exported');

await assert.rejects(
    async () => flows.unstakeAction({}),
    /unstakeAction: params is required/,
    'unstakeAction guards params',
);
await assert.rejects(
    async () => flows.unstakeAction({ params: {} }),
    /unstakeAction: params\.TIER is required/,
    'unstakeAction guards TIER',
);

await assert.rejects(
    async () => flows.claimRewardsAction({}),
    /claimRewardsAction: params is required/,
    'claimRewardsAction guards params',
);

// --- Background host + shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const h of ["'action.unstake'", "'action.claimRewards'"]) {
    assert.ok(bg.includes(h), `background host registers ${h}`);
}
assert.ok(/registerHwHandler\('action\.unstake\.hw', unstakeAction\)/.test(bg),
    'background host registers action.unstake.hw');
assert.ok(/registerHwHandler\('action\.claimRewards\.hw', claimRewardsAction\)/.test(bg),
    'background host registers action.claimRewards.hw');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['unstakeAction', 'unstakeActionHw', 'claimRewardsAction', 'claimRewardsActionHw']) {
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
    assert.ok(app.includes('StakingActionForm'),
        `${shell} App.jsx imports StakingActionForm`);
    assert.ok(app.includes("'staking-unstake'"),
        `${shell} tracks staking-unstake sub-route`);
    assert.ok(app.includes("'staking-claim'"),
        `${shell} tracks staking-claim sub-route`);
    assert.ok(/onUnstake=\{\(ref\)\s*=>\s*\{\s*setStakingRef\(ref\);\s*setUnlockedView\('staking-unstake'\)/.test(app),
        `${shell} wires StakingDashboard.onUnstake → staking-unstake with ref`);
    assert.ok(/onClaimRewards=\{\(ref\)\s*=>\s*\{\s*setStakingRef\(ref\);\s*setUnlockedView\('staking-claim'\)/.test(app),
        `${shell} wires StakingDashboard.onClaimRewards → staking-claim with ref`);
    assert.ok(/mode="unstake"/.test(app),
        `${shell} App.jsx passes mode="unstake" to StakingActionForm for the unstake route`);
    assert.ok(/mode="claim-rewards"/.test(app),
        `${shell} App.jsx passes mode="claim-rewards" to StakingActionForm for the claim route`);
}

// --- Followups note updated to include the spec/format divergence ---

const followupsPath = join(platformRoot, 'claude', 'reports', 'specs', '2026-04-24_phase4-staking-followups.md');
assert.ok(existsSync(followupsPath), 'Staking followups file exists');
const followupsSrc = readFileSync(followupsPath, 'utf8');
assert.ok(/FOLLOWUP 4/.test(followupsSrc),
    'Staking followups doc records the §42.7.2 unstake amount-vs-format divergence as FOLLOWUP 4');

console.log(
    'OK — staking action form smoke (StakingActionForm mode=unstake|claim-rewards + unstakeAction/claimRewardsAction flows + bg handlers + 3-shell messaging + two App.jsx sub-routes wired from StakingDashboard + FOLLOWUP 4 recorded)',
);
