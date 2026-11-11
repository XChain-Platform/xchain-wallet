// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Open a market follows the form rulings: the main action is the one green
// button and names what it does (Open market) with an icon, optional fields
// carry the Optional pill instead of "(optional)" in their labels, field
// explanations live in each label's help tip rather than as paragraphs under
// the fields, and every button carries an icon.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import { afterEach, describe, expect, it } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02aabbcc', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

afterEach(() => cleanup());

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function messaging(walletMode) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        betProjectFeedCreateFee: () => Promise.resolve({ durationSeconds: 3801600, days: 44, billableDays: 0, free: true, fee: '0.00000000' }),
    };
    return new Proxy(target, { get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); }, has: (t, prop) => prop in t });
}

async function mount(walletMode = 'full') {
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging(walletMode)}>
                <CreateBetFeedForm walletId="w" onBack={() => {}} chainId={CHAIN} presetTick="PEPECREATURE" />
            </MessagingProvider>,
        );
        await drain();
    });
    return utils;
}

const buttons = (utils) => [...utils.container.querySelectorAll('button')];
const named = (utils, re) => buttons(utils).find((b) => re.test(b.textContent.trim()));
const tipFor = (utils, labelText) => {
    const label = [...utils.container.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(labelText));
    const row = label?.parentElement;
    return row?.querySelector('[role="tooltip"]')?.textContent || '';
};
const isInfoTrigger = (b) => b.getAttribute('aria-describedby') && b.textContent.trim() === '?';

describe('Open a market form rulings', () => {
    it('makes Open market the one green action with an icon', async () => {
        const utils = await mount();
        const main = named(utils, /^Open market$/);
        expect(main).toBeTruthy();
        expect(main.className).toMatch(/success/);
        expect(main.querySelector('svg')).toBeTruthy();
        expect(named(utils, /^Review market$/)).toBeUndefined();
        expect(buttons(utils).filter((b) => /success/.test(b.className))).toHaveLength(1);
    });

    it('keeps the watcher build green with an icon', async () => {
        const utils = await mount('watcher');
        const main = named(utils, /^Create unsigned transaction$/);
        expect(main.className).toMatch(/success/);
        expect(main.querySelector('svg')).toBeTruthy();
    });

    it('shows Optional pills, never "(optional)" in label or button text', async () => {
        const utils = await mount();
        await domAct(async () => {
            fireEvent.click(named(utils, /^Add a description/));
            fireEvent.click(named(utils, /^Restrict who can bet$/));
            await drain();
        });
        for (const el of utils.container.querySelectorAll('label, button')) {
            expect(el.textContent).not.toMatch(/\(optional\)/i);
        }
        for (const lbl of ['Your fee', 'Smallest bet allowed', 'Description', 'Category', 'Memo']) {
            const label = [...utils.container.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(lbl));
            expect(label?.parentElement?.querySelector('[data-optional-pill]'), `${lbl} Optional pill`).toBeTruthy();
        }
    });

    it('moves field explanations into help tips', async () => {
        const utils = await mount();
        expect(tipFor(utils, 'Your oracle address')).toMatch(/only one that can publish the result/);
        expect(tipFor(utils, 'What is being bet on')).toMatch(/permanent once it is on the chain/);
        expect(tipFor(utils, 'Outcome 0')).toMatch(/Exactly one outcome can win/);
        expect(tipFor(utils, 'Betting closes')).toBeTruthy();
        expect(tipFor(utils, 'Time to publish the result')).toMatch(/longer window costs more/);
        const paragraphs = [...utils.container.querySelectorAll('p, span')].filter((el) => !el.closest('[role="tooltip"]')).map((el) => el.textContent);
        expect(paragraphs.some((t) => /This address IS the market/.test(t))).toBe(false);
        expect(paragraphs.some((t) => /^Everything above is permanent/.test(t.trim()))).toBe(false);
        expect(paragraphs.some((t) => /^Exactly one of these can win/.test(t.trim()))).toBe(false);
    });

    it('gives every button an icon', async () => {
        const utils = await mount();
        for (const b of buttons(utils)) {
            if (isInfoTrigger(b)) continue;
            expect(b.querySelector('svg'), `button "${b.textContent.trim() || b.getAttribute('aria-label')}"`).toBeTruthy();
        }
    });
});
