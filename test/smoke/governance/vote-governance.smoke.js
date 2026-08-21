// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the VOTE (token-weighted governance) authoring + reading surface:
// create poll, cast ballot, delegate / clear, and the poll list / detail reads.
// Mirrors cosigner-accounts.smoke.js: core-flow guards + background handlers +
// 3-shell messaging exports + route files + 3-shell App.jsx wiring + the
// manifest walletForm flag, so the whole chain stays connected.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- Core flows re-exported + guarded ---

const signingFlows = ['createPollAction', 'castBallotAction', 'delegateVoteAction', 'clearVoteDelegationAction'];
const readFlows = ['pollsForChain', 'pollDetail', 'pollResults', 'votesForQuery'];
for (const fn of [...signingFlows, ...readFlows]) {
    assert.equal(typeof flows[fn], 'function', `flows.${fn} re-exported`);
}

// Signing flows guard their required params before any signing prompt.
await assert.rejects(async () => flows.createPollAction({ params: {} }), /params\.tick is required/,
    'createPollAction guards params.tick');
await assert.rejects(async () => flows.castBallotAction({ params: {} }), /params\.pollRef is required/,
    'castBallotAction guards params.pollRef');
await assert.rejects(async () => flows.delegateVoteAction({ params: { tick: 'GOV' } }), /params\.delegateTo is required/,
    'delegateVoteAction guards params.delegateTo');
await assert.rejects(async () => flows.clearVoteDelegationAction({ params: {} }), /params\.tick is required/,
    'clearVoteDelegationAction guards params.tick');

// Read flows guard sdkRegistry / chainId.
await assert.rejects(async () => flows.pollsForChain({}), /sdkRegistry is required/, 'pollsForChain guards sdkRegistry');
await assert.rejects(async () => flows.pollDetail({ sdkRegistry: {} }), /chainId is required/, 'pollDetail guards chainId');

// --- Background host registrations ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of [
    'action.createPoll', 'action.castBallot', 'action.delegateVote', 'action.clearVoteDelegation',
    'action.createPoll.hw', 'action.castBallot.hw', 'action.delegateVote.hw', 'action.clearVoteDelegation.hw',
    'governance.polls', 'governance.poll', 'governance.pollResults', 'governance.votes',
]) {
    assert.ok(bg.includes(`'${route}'`), `background host registers ${route}`);
}
assert.ok(/createPollAction\b/.test(bg), 'bg host wires createPollAction');
assert.ok(/pollsForChain\b/.test(bg), 'bg host wires pollsForChain');

// --- 3-shell messaging exports ---

const messagingFns = [
    'createPollAction', 'createPollActionHw', 'castBallotAction', 'castBallotActionHw',
    'delegateVoteAction', 'delegateVoteActionHw', 'clearVoteDelegationAction', 'clearVoteDelegationActionHw',
    'governancePolls', 'governancePoll', 'governancePollResults', 'governanceVotes',
];
for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of messagingFns) {
        assert.ok(new RegExp(`export function ${fn}\\b`).test(m), `${shell} messaging.js exports ${fn}`);
    }
    assert.ok(m.includes("'action.createPoll'"), `${shell} messaging.js sends action.createPoll`);
    assert.ok(m.includes("'governance.polls'"), `${shell} messaging.js sends governance.polls`);
}

// --- Route files ---

for (const [file, named] of [
    ['GovernancePolls.jsx', 'GovernancePolls'],
    ['CreatePollForm.jsx', 'CreatePollForm'],
    ['PollDetail.jsx', 'PollDetail'],
    ['DelegateVoteForm.jsx', 'DelegateVoteForm'],
]) {
    const p = join(sharedRoutes, file);
    assert.ok(existsSync(p), `${file} exists`);
    const src = readFileSync(p, 'utf8');
    assert.ok(new RegExp(`export function ${named}\\b`).test(src), `${file} named-exports ${named}`);
}

const createSrc = readFileSync(join(sharedRoutes, 'CreatePollForm.jsx'), 'utf8');
assert.ok(/messaging\.createPollAction/.test(createSrc), 'CreatePollForm calls messaging.createPollAction');
const detailSrc = readFileSync(join(sharedRoutes, 'PollDetail.jsx'), 'utf8');
assert.ok(/messaging\.castBallotAction/.test(detailSrc), 'PollDetail casts a ballot via messaging.castBallotAction');
assert.ok(/messaging\.governancePollResults/.test(detailSrc), 'PollDetail reads frozen results via messaging.governancePollResults');
const delegSrc = readFileSync(join(sharedRoutes, 'DelegateVoteForm.jsx'), 'utf8');
assert.ok(/messaging\.delegateVoteAction/.test(delegSrc), 'DelegateVoteForm delegates via messaging.delegateVoteAction');
assert.ok(/messaging\.clearVoteDelegationAction/.test(delegSrc), 'DelegateVoteForm clears via messaging.clearVoteDelegationAction');

// --- Chain gating (governance is capability-gated, NOT hardcoded BTC-only) ---

const gateHook = join(core, 'src', 'shared', 'hooks', 'useGovernanceAddressesPresent.js');
assert.ok(existsSync(gateHook), 'useGovernanceAddressesPresent hook exists');
const gateSrc = readFileSync(gateHook, 'utf8');
// The gate asks the LIVE registry for every chain whose descriptor advertises
// VOTE (useChainIdsWithAction), never a module-scope snapshot, so a synced
// descriptor reaches the nav entry without a restart.
assert.ok(/useChainIdsWithAction\('VOTE'\)|supportedActions.*includes\('VOTE'\)/.test(gateSrc),
    'governance gate resolves chains by supportedActions.includes(VOTE)');

const actionsList = readFileSync(join(core, 'src', 'registry', 'actions.js'), 'utf8');
assert.ok(/COMMON_ACTIONS[\s\S]*'VOTE'/.test(actionsList), 'VOTE is a COMMON action (not BTC-only)');

// --- 3-shell App.jsx wiring ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    for (const cmp of ['GovernancePolls', 'CreatePollForm', 'PollDetail', 'DelegateVoteForm']) {
        assert.ok(app.includes(cmp), `${shell} App.jsx imports ${cmp}`);
    }
    for (const view of ['governance-polls', 'governance-create-poll', 'governance-poll-detail', 'governance-delegate']) {
        assert.ok(app.includes(`'${view}'`), `${shell} tracks '${view}' sub-route`);
    }
    assert.ok(
        /onVoteGovernance: hasGovernanceAddress \? \(\) => setUnlockedView\('governance-polls'\)/.test(app),
        `${shell} gates onVoteGovernance via hasGovernanceAddress`,
    );
    assert.ok(surfacesEntry(app, 'governance-polls', 'Governance'), `${shell} surfaces the "Governance" action entry`);
}

// --- Manifest walletForm flag ---

const manifest = JSON.parse(readFileSync(join(wsRoot, 'test', 'fixtures', 'action-manifest.json'), 'utf8'));
assert.equal(manifest.actions.VOTE.walletForm, true, 'manifest marks VOTE.walletForm = true');

console.log(
    'OK: VOTE governance smoke (core-flow guards + action.createPoll/castBallot/delegateVote/clearVoteDelegation(.hw) + governance.* read handlers + 3-shell messaging exports + polls/create/detail/delegate routes + capability-gated (non-BTC-only) chain gate + 3-shell App.jsx sub-routes + Governance action entry + manifest walletForm)',
);
