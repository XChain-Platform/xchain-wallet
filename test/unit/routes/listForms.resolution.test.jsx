// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Lists screens against list-edit resolution, and the list-form gaps
// found beside it on Dogecoin testnet.
//
//   RESOLUTION  - since LIST_EDIT_RESOLUTION_ACTIVATION a reference to a list
//                 resolves to its newest valid edit. ListDetail showed the
//                 as-created rows under "Current members" and the fork form
//                 said the original "never changes"; both now branch on the
//                 explorer's state.edit_resolution_active.
//   REPOINT     - the three repoint targets were hardcoded unbuilt although
//                 their edit screens exist; they now open through the shell.
//   MEMO        - LIST carries an optional MEMO on both versions; neither
//                 form offered one.
//   TICKS       - a token list only counted lines, so an unknown TICK the
//                 network leaves out was never reported.
//   PASSWORD    - "enter your password twice" showed on an unlocked wallet.
//   CHAIN       - Create list opened on the wallet's oldest chain.
//
// Each block mounts the real screen, since every defect was in what the
// screen rendered or sent, not in a helper.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { classifyTickItems, tickLookupVerdict } from '../../../packages/core/src/shared/utils/listTickItems.js';


const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';

const hd = (prefix, coinType) => ({
    id: `${prefix}-0`,
    address: `${prefix}1qindex0indexindexindexindexindexindex`,
    publicKey: '02a0',
    derivationPath: `m/84'/${coinType}'/0'/0/0`,
    source: 'hd',
    signerId: 'signer-1',
});

// Creation order: Bitcoin first. The old Create list default read this order.
const BY_CHAIN = Object.freeze({ [BTC]: [hd('bc', 0)], [DOGE]: [hd('doge', 3)] });

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ ...BY_CHAIN }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: 'bc-0' }, [DOGE]: { id: 'doge-0' } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
        getTokenInfo: vi.fn().mockResolvedValue(null),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop !== 'string') return undefined;
            return () => Promise.resolve(null);
        },
        has: (t, prop) => prop in t,
    });
}

function mount(Component, props, messaging) {
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, props),
    ));
    return messaging;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); __clearTokenInfoCache(); });

// LIST #2700 from the testnet repro: created SWAPTEST, MGRTEST (plus an
// unknown tick the network left out), then edited to DOGESWAP, SWAPTEST.
const LIST_2700 = {
    action_index: 2700, type: '1', status: 'valid', source: 'nsource', block_index: 10,
    list: ['MGRTEST', 'SWAPTEST'],
    edits: [
        { tick: 'SWAPTEST', status: 'valid' },
        { tick: 'MGRTEST', status: 'valid' },
        { tick: 'NOSUCHTICKQA', status: 'invalid: TICK (unknown)' },
    ],
};
const ACTIVE_STATE = { edit_resolution_active: true, membership_action_index: 2703, current_list: ['DOGESWAP', 'SWAPTEST'] };

function mountDetail(row, onFork = vi.fn()) {
    mount(ListDetail, { chainId: DOGE, actionIndex: '2700', onBack() {}, onFork },
        messagingWith({ getListByActionIndex: vi.fn().mockResolvedValue(row) }));
    return onFork;
}

describe('ListDetail membership under list-edit resolution', () => {
    it('shows state.current_list as current, labelled with its edit, and keeps the create rows as "As created"', async () => {
        const onFork = mountDetail({ ...LIST_2700, state: ACTIVE_STATE });
        expect(await screen.findByText('Current members (2)')).toBeTruthy();
        expect(screen.getByText(/From edit #2703/)).toBeTruthy();
        expect(screen.getByText('DOGESWAP')).toBeTruthy();
        expect(screen.getByText('As created (2)')).toBeTruthy();
        expect(screen.getByText('MGRTEST')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Fork & edit/ }));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({
            items: ['DOGESWAP', 'SWAPTEST'], editResolutionActive: true,
        }));
    });

    it('before activation keeps the pinned rows as the current members and has no "As created" block', async () => {
        const onFork = mountDetail({ ...LIST_2700, state: { edit_resolution_active: false, membership_action_index: 2700, current_list: null } });
        expect(await screen.findByText('Current members (2)')).toBeTruthy();
        expect(screen.queryByText(/As created/)).toBeNull();
        expect(screen.queryByText('DOGESWAP')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Fork & edit/ }));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({
            items: ['MGRTEST', 'SWAPTEST'], editResolutionActive: false,
        }));
    });

    it('an explorer without a state object labels the rows as published, not as current', async () => {
        const onFork = mountDetail({ ...LIST_2700 });
        expect(await screen.findByText('Members as published (2)')).toBeTruthy();
        expect(screen.queryByText(/Current members/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Fork & edit/ }));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({ editResolutionActive: null }));
    });

    it('reports the items the network left out of a create', async () => {
        mountDetail({ ...LIST_2700, state: ACTIVE_STATE });
        expect(await screen.findByText('Left out by the network (1)')).toBeTruthy();
        expect(screen.getByText('NOSUCHTICKQA')).toBeTruthy();
    });
});

const forkRef = (editResolutionActive) => ({
    chainId: DOGE, actionIndex: '2700', type: '1', items: ['DOGESWAP', 'SWAPTEST'], editResolutionActive,
});
const WATCHER = { getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }) };

function mountFork(editResolutionActive, overrides = {}, repointHandlers) {
    return mount(ListForkForm, {
        walletId: 'w', listRef: forkRef(editResolutionActive), onBack() {}, onDone() {}, repointHandlers,
    }, messagingWith(overrides));
}

// Watcher mode goes compose -> review -> build unsigned -> the repoint step
// without a signer, which is the shortest real path to that step.
async function forkToRepoint({ add = 'NEWTICK', memo = '' } = {}) {
    await screen.findByText(/Forking token list #2700/);
    fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: add } });
    if (memo) fireEvent.change(screen.getByLabelText(/Memo/), { target: { value: memo } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));
    await screen.findByText('Fork submitted');
}

describe('ListForkForm copy follows list-edit resolution', () => {
    it('under resolution says the edit becomes the list\'s current membership', async () => {
        mountFork(true);
        const summary = await screen.findByText(/Forking token list #2700/);
        expect(summary.textContent).toMatch(/becomes list #2700's current membership/);
        expect(summary.textContent).not.toMatch(/never changes/);
    });

    it('before activation keeps "#2700 itself never changes"', async () => {
        mountFork(false);
        const summary = await screen.findByText(/Forking token list #2700/);
        expect(summary.textContent).toMatch(/#2700 itself never changes/);
    });

    it('with the flag unknown names both rules instead of asserting either', async () => {
        mountFork(null);
        const summary = await screen.findByText(/Forking token list #2700/);
        expect(summary.textContent).toMatch(/Where list-edit resolution is active/);
        expect(summary.textContent).not.toMatch(/never changes/);
    });

    it('under resolution the repoint step is optional and the "stays live" warning is gone', async () => {
        mountFork(true, WATCHER);
        await forkToRepoint();
        expect(screen.getByText('Repoint (optional)')).toBeTruthy();
        expect(screen.queryByText(/stays live everywhere/)).toBeNull();
        expect(screen.queryByText(/is unchanged and keeps working/)).toBeNull();
        expect(screen.getByText(/this edit is list #2700.s current/)).toBeTruthy();
    });

    it('before activation keeps the unchanged-original copy and the stays-live warning', async () => {
        mountFork(false, WATCHER);
        await forkToRepoint();
        expect(screen.getByText('Now referenced by')).toBeTruthy();
        expect(screen.getByText(/stays live everywhere it is referenced/)).toBeTruthy();
        expect(screen.getByText(/itself is unchanged/)).toBeTruthy();
    });
});

// Fork & edit signed from the active address even when the list belonged to
// another address in the wallet. Once owner-only list edits are armed on a
// chain, only the root create's SOURCE may edit, so FROM defaults to that
// address when the wallet holds it and warns when it does not.
describe('ListForkForm signs from the list owner', () => {
    const OWNER = { ...hd('nowner', 3), id: 'doge-owner', address: 'nownerownerownerownerownerownerown' };
    const byChainWithOwner = { [BTC]: [hd('bc', 0)], [DOGE]: [hd('doge', 3), OWNER] };
    // #3069 is an edit of #2701; #2701 is the root create, made by OWNER.
    const rows = {
        2701: { action_index: 2701, type: '1', source: OWNER.address, list_action_index: null },
        3069: { action_index: 3069, type: '1', source: 'nsomeoneelsesomeoneelsesomeonee', list_action_index: 2701 },
    };
    const editRef = { chainId: DOGE, actionIndex: '3069', type: '1', items: ['SWAPTEST'], editResolutionActive: true,
        source: rows[3069].source, parentIndex: '2701' };
    const mountOwnerFork = (byChain) => mount(ListForkForm, { walletId: 'w', listRef: editRef, onBack() {}, onDone() {} },
        messagingWith({
            ...WATCHER,
            getAddressesByChain: vi.fn().mockResolvedValue(byChain),
            getListByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve(rows[actionIndex] || null)),
        }));

    it('defaults FROM to the root creator when the wallet holds it, with no warning', async () => {
        const messaging = mountOwnerFork(byChainWithOwner);
        await screen.findByText(/Forking token list #3069/);
        await waitFor(() => expect(screen.getByText(/Signed from/).textContent).toContain(OWNER.address.slice(0, 6)));
        expect(screen.queryByText(/which is not an address in this wallet/)).toBeNull();
        fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalled());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].from.address).toBe(OWNER.address);
    });

    it('warns when the wallet does not hold the list owner', async () => {
        mountOwnerFork({ ...BY_CHAIN });
        await screen.findByText(/Forking token list #3069/);
        const warning = await screen.findByText(/which is not an address in this wallet/);
        expect(warning.textContent).toContain(`created by ${OWNER.address.slice(0, 8)}`);
        expect(warning.textContent).toMatch(/only the list's creator can edit it/);
    });
});

// The fork form works from the members ListDetail read when it opened, but
// the network applies the edit to the list's newest valid edit at the time.
// An edit published in between (by anyone, while owner-only edits are not
// armed) was carried into the new version unseen, so the form re-reads first.
describe('ListForkForm refuses to build on members that changed since it loaded', () => {
    const rowWith = (current) => ({ ...LIST_2700, state: { ...ACTIVE_STATE, current_list: current } });

    it('stops at Review when the list gained a member the screen never showed', async () => {
        const messaging = mountFork(true, {
            ...WATCHER,
            getListByActionIndex: vi.fn().mockResolvedValue(rowWith(['DOGESWAP', 'INJECTED', 'SWAPTEST'])),
        });
        await screen.findByText(/Forking token list #2700/);
        fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        const error = await screen.findByText(/List #2700 changed since this screen loaded/);
        expect(error.textContent).toMatch(/now has 3 members, not 2/);
        expect(screen.queryByRole('button', { name: 'Create unsigned transaction' })).toBeNull();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('goes ahead when the re-read matches, in any order', async () => {
        const messaging = mountFork(true, {
            ...WATCHER,
            getListByActionIndex: vi.fn().mockResolvedValue(rowWith(['SWAPTEST', 'DOGESWAP'])),
        });
        await forkToRepoint();
        expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1);
    });
});

// An airdrop to an existing list pays the list's newest valid edit, so the
// recipient count (and the total cost and Max built on it) must come from
// state.current_list, not from the members the list was created with.
describe('AirdropForm existing-list preview counts the members the airdrop will pay', () => {
    it('counts state.current_list, not the as-created rows', async () => {
        const row = {
            action_index: 2701, type: '2', status: 'valid', source: BY_CHAIN[BTC][0].address, block_index: 10,
            list: ['bc1qcreated0', 'bc1qcreated1'],
            state: { edit_resolution_active: true, membership_action_index: 3082,
                current_list: ['bc1qcreated0', 'bc1qcreated1', 'bc1qadded2', 'bc1qadded3', 'bc1qadded4'] },
        };
        mount(AirdropForm, { walletId: 'w', initialChainId: BTC, initialTick: 'JDOG', onBack() {} }, messagingWith({
            getListsForSource: vi.fn().mockResolvedValue([row]),
            getListByActionIndex: vi.fn().mockResolvedValue(row),
        }));
        fireEvent.change(await screen.findByLabelText(/^Airdrop to/), { target: { value: 'existing' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Choose list' }));
        fireEvent.click(await screen.findByRole('button', { name: /Address list #2701/ }));
        expect(await screen.findByText('5 addresses on this list.')).toBeTruthy();
    });
});

describe('ListCreateForm edit copy follows list-edit resolution', () => {
    const copyFor = async (editResolutionActive) => {
        mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '2', editResolutionActive, onBack() {} }, messagingWith());
        return (await screen.findByText(/permanent public on-chain data/)).textContent;
    };

    it('under resolution says an edit changes what every reference uses', async () => {
        const text = await copyFor(true);
        expect(text).toMatch(/everything that references this list then uses the edited membership/);
        expect(text).not.toMatch(/no way to edit/);
    });

    it('before activation keeps "no way to edit"', async () => {
        expect(await copyFor(false)).toMatch(/There's no way to edit or delete an address out of a list later/);
    });

    it('with the flag unknown names both rules', async () => {
        const text = await copyFor(undefined);
        expect(text).toMatch(/where list-edit resolution is active/);
        expect(text).not.toMatch(/no way to edit/);
    });
});

describe('ListForkForm repoint targets open their edit screens', () => {
    it('every target is enabled and calls the shell handler', async () => {
        const handlers = { 'issue-lists': vi.fn(), 'dispenser-lists': vi.fn(), 'order-lists': vi.fn() };
        mountFork(false, WATCHER, handlers);
        await forkToRepoint();
        for (const [label, id] of [
            ['Token allow/block lists', 'issue-lists'],
            ['Dispenser allow/block lists', 'dispenser-lists'],
            ['Order allow/block lists', 'order-lists'],
        ]) {
            const button = screen.getByRole('button', { name: label });
            expect(button.disabled).toBe(false);
            fireEvent.click(button);
            expect(handlers[id]).toHaveBeenCalledTimes(1);
        }
        expect(screen.queryByText(/coming soon/)).toBeNull();
    });

    it('a target the shell cannot route stays disabled rather than a dead link', async () => {
        mountFork(false, WATCHER, { 'issue-lists': vi.fn() });
        await forkToRepoint();
        expect(screen.getByRole('button', { name: 'Token allow/block lists' }).disabled).toBe(false);
        expect(screen.getByRole('button', { name: 'Order allow/block lists' }).disabled).toBe(true);
    });
});

describe('List forms send an optional MEMO', () => {
    it('ListForkForm puts the memo on the LIST v1 params', async () => {
        const messaging = mountFork(true, WATCHER);
        await forkToRepoint({ memo: 'Removed at their request' });
        const req = messaging.buildActionPsbtRequest.mock.calls[0][0];
        expect(req.actionData.params).toMatchObject({ VERSION: '1', MEMO: 'Removed at their request', ITEM: ['NEWTICK'] });
    });

    it('ListCreateForm puts the memo on the LIST v0 params and leaves it out when empty', async () => {
        const messaging = mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} },
            messagingWith(WATCHER));
        fireEvent.change(await screen.findByLabelText(/Tokens \(one per line\)/), { target: { value: 'SWAPTEST' } });
        fireEvent.change(screen.getByLabelText(/Memo/), { target: { value: 'Our official tokens' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Our official tokens')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalled());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].actionData.params)
            .toMatchObject({ VERSION: '0', TYPE: '1', MEMO: 'Our official tokens', ITEM: ['SWAPTEST'] });
    });

    it('ListCreateForm refuses a memo with a protocol delimiter', async () => {
        mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} }, messagingWith(WATCHER));
        fireEvent.change(await screen.findByLabelText(/Tokens \(one per line\)/), { target: { value: 'SWAPTEST' } });
        fireEvent.change(screen.getByLabelText(/Memo/), { target: { value: 'a|b' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText(/Memo cannot contain \| or ;/)).toBeTruthy();
    });
});

describe('ListCreateForm checks token items before publishing', () => {
    const KNOWN = { creator: 'nowner', totalSupply: '100', canonicalTick: 'SWAPTEST' };
    const UNKNOWN = { creator: null, totalSupply: null, canonicalTick: null };

    it('counts valid, duplicate and malformed names, and flags a tick the chain does not know', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(tick === 'SWAPTEST' ? KNOWN : UNKNOWN));
        mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} }, messagingWith({ getTokenInfo }));
        fireEvent.change(await screen.findByLabelText(/Tokens \(one per line\)/), {
            target: { value: 'SWAPTEST\nNOSUCHTICKQA\nswaptest\nBAD TICK' },
        });
        const counts = await screen.findByText(/2 valid token names/);
        expect(counts.textContent).toMatch(/1 duplicate removed/);
        expect(counts.textContent).toMatch(/1 invalid/);
        await waitFor(() => expect(counts.textContent).toMatch(/1 found · 1 not found/), { timeout: 3000 });
        expect(screen.getByRole('alert').textContent).toMatch(/Not found on Dogecoin.*NOSUCHTICKQA/);
        expect(getTokenInfo).toHaveBeenCalledWith({ chainId: DOGE, tick: 'NOSUCHTICKQA' });
    });

    it('classifyTickItems and tickLookupVerdict keep the three verdicts apart', () => {
        expect(classifyTickItems('a, B\nb\n\nx y')).toEqual({ valid: ['A', 'B'], invalid: ['X Y'], duplicates: 1 });
        expect(tickLookupVerdict(null)).toBe(null);
        expect(tickLookupVerdict(UNKNOWN)).toBe('missing');
        expect(tickLookupVerdict(KNOWN)).toBe('found');
    });
});

describe('two-step copy does not ask an unlocked wallet for a password', () => {
    async function forkReviewTwoPhase(ready) {
        mountFork(true, { signerReady: vi.fn().mockResolvedValue({ ready }) });
        await screen.findByText(/Forking token list #2700/);
        fireEvent.click(screen.getByRole('checkbox', { name: /DOGESWAP/ }));
        fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        return screen.findByText(/two\s+transactions/);
    }

    it('ListForkForm, unlocked', async () => {
        const hint = await forkReviewTwoPhase(true);
        await waitFor(() => expect(hint.textContent).toMatch(/no password is needed/));
        expect(hint.textContent).not.toMatch(/password twice/);
    });

    it('ListForkForm, locked', async () => {
        const hint = await forkReviewTwoPhase(false);
        expect(hint.textContent).toMatch(/enter your password twice/);
    });

    it('ProjectRosterForm, unlocked', async () => {
        mount(ProjectRosterForm, { walletId: 'w', chainId: DOGE, tick: 'PROJ', onBack() {} }, messagingWith({
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
        }));
        fireEvent.change(await screen.findByLabelText('Tokens (one per line)'), { target: { value: 'SWAPTEST' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Review list' }));
        const hint = await screen.findByText(/This is step 1 of 2/);
        await waitFor(() => expect(hint.textContent).toMatch(/no password is needed/));
    });

    // Drives the recipients path to the list review, where the line renders.
    async function airdropReviewHint(ready) {
        mount(AirdropForm, { walletId: 'w', initialChainId: BTC, initialTick: 'JDOG', onBack() {} }, messagingWith({
            signerReady: vi.fn().mockResolvedValue({ ready }),
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: BTC, tick: 'JDOG', divisibility: 8, locks: {} }),
        }));
        fireEvent.change(await screen.findByLabelText(/^Per-recipient amount/), { target: { value: '5' } });
        const box = document.querySelector('textarea');
        fireEvent.change(box, {
            target: { value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4\n1FWDonkMbC6hL64JiysuggHnUAw2CKWszs' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Review recipients' }));
        return screen.findByText(/^Airdrop is a two-transaction flow/);
    }

    it('AirdropForm, unlocked', async () => {
        const hint = await airdropReviewHint(true);
        await waitFor(() => expect(hint.textContent).toMatch(/no password is needed/));
    });

    it('AirdropForm, locked', async () => {
        const hint = await airdropReviewHint(false);
        expect(hint.textContent).toMatch(/enter your password twice/);
    });
});

describe('ListCreateForm chain default', () => {
    it('opens on the last-used chain, not the first-created one', async () => {
        const messaging = mount(ListCreateForm, { walletId: 'w', onBack() {} }, messagingWith({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet', lastUsedChain: { mainnet: DOGE } }),
        }));
        const button = await screen.findByRole('button', { name: /^Network: / });
        await waitFor(() => expect(button.getAttribute('aria-label') || button.textContent).toMatch(/^Network: Dogecoin/));
        expect(messaging.getSettings).toHaveBeenCalled();
    });

    it('falls back to the first chain when nothing was used yet', async () => {
        mount(ListCreateForm, { walletId: 'w', onBack() {} }, messagingWith());
        const button = await screen.findByRole('button', { name: /^Network: / });
        expect(button.getAttribute('aria-label') || button.textContent).toMatch(/^Network: Bitcoin/);
    });
});
