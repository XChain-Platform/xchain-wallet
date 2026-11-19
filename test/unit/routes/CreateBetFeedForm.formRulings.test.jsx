// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Open a market follows the form rulings: the main action is the one green
// button and names what it does (Open Market) with an icon, optional fields
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
import * as walletModes from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02aabbcc', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

// The Quick | Full choice is remembered in localStorage; reset it so each test
// starts on the default Quick view.
afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear();
    walletModes.resetWalletModes?.();
});

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
    // A wallet's mode is published by the shell from the wallet list, not read from settings.
    walletModes.publishWalletModes?.({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
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
        const main = named(utils, /^Open Market$/);
        expect(main).toBeTruthy();
        expect(main.className).toMatch(/success/);
        expect(main.querySelector('svg')).toBeTruthy();
        expect(named(utils, /^Review Market$/i)).toBeUndefined();
        expect(buttons(utils).filter((b) => /success/.test(b.className))).toHaveLength(1);
    });

    it('keeps the watcher build green with an icon', async () => {
        const utils = await mount('watcher');
        const main = named(utils, /^Create unsigned transaction$/i);
        expect(main.className).toMatch(/success/);
        expect(main.querySelector('svg')).toBeTruthy();
    });

    it('shows Optional pills, never "(optional)" in label or button text', async () => {
        const utils = await mount();
        // Description and Category live in the Full view; the closed sections
        // stay mounted, so their labels are queryable without opening them.
        await domAct(async () => {
            fireEvent.click(named(utils, /^Full$/));
            await drain();
        });
        for (const el of utils.container.querySelectorAll('label, button')) {
            expect(el.textContent).not.toMatch(/\(optional\)/i);
        }
        for (const lbl of ['Your Fee', 'Minimum Purchase', 'Description', 'Category']) {
            const label = [...utils.container.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(lbl));
            expect(label?.parentElement?.querySelector('[data-optional-pill]'), `${lbl} Optional pill`).toBeTruthy();
        }
        // Memo is its own optional section, so the pill sits on its header.
        expect(utils.container.querySelector('[data-form-section="memo"] [data-form-section-toggle] [data-optional-pill]'), 'Memo Optional pill').toBeTruthy();
    });

    it('moves field explanations into help tips', async () => {
        const utils = await mount();
        // The oracle address is the From address; the Quick view's Market
        // section holds the question, the Outcomes group and Closes.
        expect(tipFor(utils, 'From address')).toMatch(/only one that can publish the result/);
        // Field help only; that the terms are permanent is the confirm
        // screen's warnings card (actionWarnings MARKET_CREATE).
        expect(tipFor(utils, 'Question')).toBe('The question participants choose an outcome for, such as who wins a match.');
        const outcomesLabel = [...utils.container.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Outcomes');
        expect(outcomesLabel?.parentElement?.querySelector('[role="tooltip"]')?.textContent || '').toMatch(/Exactly one outcome can win/);
        expect(tipFor(utils, 'Closes')).toBeTruthy();
        expect(tipFor(utils, 'Time to Publish the Result')).toMatch(/longer window costs more/);
        const paragraphs = [...utils.container.querySelectorAll('p, span')].filter((el) => !el.closest('[role="tooltip"]')).map((el) => el.textContent);
        expect(paragraphs.some((t) => /This address IS the market/.test(t))).toBe(false);
        expect(paragraphs.some((t) => /^Everything above is permanent/.test(t.trim()))).toBe(false);
        expect(paragraphs.some((t) => /^Exactly one of these can win/.test(t.trim()))).toBe(false);
    });

    it('puts each outcome circle inside its input wrapper and gives the Outcomes label no icon (G112)', async () => {
        const utils = await mount();
        const outcomesLabel = [...utils.container.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Outcomes');
        expect(outcomesLabel).toBeTruthy();
        // The label's first child is its text: no leading icon.
        expect(outcomesLabel.parentElement.firstElementChild).toBe(outcomesLabel);
        const fields = utils.container.querySelectorAll('[data-testid="outcome-field"]');
        expect(fields.length).toBeGreaterThanOrEqual(2);
        for (const field of fields) {
            const dot = field.querySelector('[data-testid="outcome-dot"]');
            expect(dot, 'circle inside the input wrapper').toBeTruthy();
            expect(field.querySelector('input[aria-label^="Outcome "]')).toBeTruthy();
            expect(dot.getAttribute('aria-hidden')).toBe('true');
        }
        // No circle remains outside an input wrapper.
        const allDots = utils.container.querySelectorAll('[data-testid="outcome-dot"]');
        expect(allDots.length).toBe(fields.length);
    });

    it('gives every button an icon', async () => {
        const utils = await mount();
        for (const b of buttons(utils)) {
            if (isInfoTrigger(b)) continue;
            expect(b.querySelector('svg'), `button "${b.textContent.trim() || b.getAttribute('aria-label')}"`).toBeTruthy();
        }
    });
});
