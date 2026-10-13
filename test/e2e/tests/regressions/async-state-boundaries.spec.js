// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWallet, expect, gotoSection, mainButton, test, unlockedShell } from '../../fixtures/wallet.js';

const PASSWORD = 'async-boundaries-123';
const VALID_BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const FIRST_WALLET_BALANCE = '9.87654321';
const STALE_GENERATED_ADDRESS = 'bc1qstalegeneration0000000000000000000000000';

async function installRaceProbe(page) {
    await page.addInitScript(() => {
        window.__xchainRaceProbe = {
            calls: {},
            completed: {},
            firstBalanceWalletId: null,
            held: null,
            holdAfterNext: null,
            holdNext: null,
            holdWalletId: null,
            release: null,
            results: {},
            wallets: [],
        };
    });

    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;
        const replacement = `    const { sendMessage: sendToHost } = await loadHostBridge();
    const probe = globalThis.__xchainRaceProbe;
    if (probe) {
        probe.calls[type] = (probe.calls[type] || 0) + 1;
        const heldWalletMatches = type !== 'balances.wallet'
            || !probe.holdWalletId
            || probe.holdWalletId === request?.walletId;
        if (probe.holdNext === type && heldWalletMatches) {
            probe.holdNext = null;
            probe.holdWalletId = null;
            probe.held = type;
            await new Promise((resolve) => { probe.release = resolve; });
        }
    }
    try {
        const result = await sendToHost(type, request);
        if (probe && probe.holdAfterNext === type) {
            probe.holdAfterNext = null;
            probe.held = \`after:\${type}\`;
            probe.results[type] = type === 'receive.getAddress' ? result?.address : result;
            await new Promise((resolve) => { probe.release = resolve; });
        }
        if (probe && type === 'wallet.list' && Array.isArray(result)) {
            probe.wallets = result.map(({ id, name }) => ({ id, name }));
        }
        if (probe && type === 'balances.wallet') {
            if (!probe.firstBalanceWalletId) probe.firstBalanceWalletId = request?.walletId || null;
            if (request?.walletId === probe.firstBalanceWalletId) {
                const tagged = structuredClone(result);
                for (const entries of Object.values(tagged || {})) {
                    for (const entry of Array.isArray(entries) ? entries : []) {
                        if (entry?.balances?.native?.tick === 'BTC') {
                            entry.balances.native.quantity = '987654321';
                        }
                    }
                }
                return tagged;
            }
        }
        if (probe && type === 'receive.getAddress') {
            return { ...result, address: '${STALE_GENERATED_ADDRESS}' };
        }
        return result;
    } finally {
        if (probe) probe.completed[type] = (probe.completed[type] || 0) + 1;
    }`;
        if (!source.includes(original)) {
            throw new Error('The web messaging seam changed; update the race probe.');
        }
        await route.fulfill({ response, body: source.replace(original, replacement) });
    });

    await page.route('**/src/App.jsx*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `    const handleSwitchWallet = (id) => {
        setActiveAccountId(null);
        setActiveWalletId(id);
        if (id) writeActiveWallet(id, walletList.find((wallet) => wallet.id === id)?.name);
    };`;
        // Vite serves a .jsx module re-printed by esbuild, so its indentation
        // differs from the file on disk; match the statements, not the spacing.
        const seam = new RegExp(
            original.trim()
                .replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)
                .replace(/\s+/g, '\\s*'),
        );
        if (!seam.test(source)) {
            throw new Error('The web wallet switch seam changed; update the race probe.');
        }
        const body = source.replace(seam, (match) => `${match}\nglobalThis.__xchainE2ESwitchWallet = handleSwitchWallet;`);
        await route.fulfill({ response, body });
    });
}

async function holdNext(page, type) {
    await page.evaluate((messageType) => {
        window.__xchainRaceProbe.holdNext = messageType;
    }, type);
}

async function holdAfterNext(page, type) {
    await page.evaluate((messageType) => {
        window.__xchainRaceProbe.holdAfterNext = messageType;
    }, type);
}

async function waitForHold(page, type) {
    await expect.poll(() => page.evaluate(
        (messageType) => window.__xchainRaceProbe.held === messageType,
        type,
    )).toBe(true);
}

async function releaseHold(page) {
    await page.evaluate(() => {
        const release = window.__xchainRaceProbe.release;
        window.__xchainRaceProbe.release = null;
        release?.();
    });
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function addSecondWallet(page) {
    await gotoPalette(page, 'Switch wallet');
    await page.getByRole('button', { name: 'Add wallet' }).click();
    await createWallet(page, {
        password: PASSWORD,
        name: 'Second Wallet',
        navigate: false,
    });
    await expect(unlockedShell(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await installRaceProbe(page);
});

test('a double-tap on Send review starts one signing request', async ({ page }) => {
    await createWallet(page, { password: PASSWORD });
    await gotoSection(page, 'Send');
    await page.getByLabel('To', { exact: true }).fill(VALID_BTC);
    await page.getByRole('textbox', { name: /^Amount/ }).fill('0.001');
    await mainButton(page, 'Send').click();

    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled();
    await holdNext(page, 'action.send');
    await approve.evaluate((button) => {
        button.click();
        button.click();
    });

    await waitForHold(page, 'action.send');
    await expect(approve).toBeDisabled();
    expect(await page.evaluate(() => window.__xchainRaceProbe.calls['action.send'])).toBe(1);
    await releaseHold(page);
    await expect(page.getByRole('alert').first()).toBeVisible();
});

test('switching wallets while balances load never paints the previous wallet balance', async ({ page }) => {
    await createWallet(page, { password: PASSWORD, name: 'First Wallet' });
    const firstBtc = page.locator('[data-balance-key="bitcoin-mainnet:BTC"]');
    await expect(firstBtc).toContainText(FIRST_WALLET_BALANCE);
    await addSecondWallet(page);
    await expect(firstBtc).toContainText(FIRST_WALLET_BALANCE);

    const secondWalletId = await page.evaluate(() => (
        window.__xchainRaceProbe.wallets.find(({ name }) => name === 'Second Wallet')?.id
    ));
    expect(secondWalletId).toBeTruthy();

    await page.evaluate(({ walletId, oldBalance }) => {
        const probe = window.__xchainRaceProbe;
        probe.holdNext = 'balances.wallet';
        probe.holdWalletId = walletId;
        probe.balanceLeak = false;
        probe.balanceObserver = new MutationObserver(() => {
            const identity = document.querySelector(
                '[aria-label="App header"] [data-testid="wallet-identity"]',
            );
            if (identity?.textContent?.includes('Second Wallet')
                && document.body.textContent?.includes(oldBalance)) {
                probe.balanceLeak = true;
            }
        });
        probe.balanceObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        window.__xchainE2ESwitchWallet(walletId);
    }, { walletId: secondWalletId, oldBalance: FIRST_WALLET_BALANCE });

    await waitForHold(page, 'balances.wallet');
    await expect(page.getByRole('region', { name: 'App header' })).toContainText('Second Wallet');
    await expect(page.getByText(FIRST_WALLET_BALANCE, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__xchainRaceProbe.balanceLeak)).toBe(false);

    await releaseHold(page);
    await expect(firstBtc).toContainText('50.00000000');
    await page.evaluate(() => window.__xchainRaceProbe.balanceObserver.disconnect());
});

test('leaving Receive during generation does not paint its late address after returning', async ({ page }) => {
    await createWallet(page, { password: PASSWORD });
    await gotoSection(page, 'Receive');
    const address = page.getByLabel('Address', { exact: true });
    await expect(address).toHaveValue(/^[a-zA-Z0-9]{20,}$/);
    const initialAddress = await address.inputValue();

    await holdAfterNext(page, 'receive.getAddress');
    await page.getByRole('button', { name: 'Generate new address' }).click();
    await waitForHold(page, 'after:receive.getAddress');
    const generatedAddress = await page.evaluate(
        () => window.__xchainRaceProbe.results['receive.getAddress'],
    );
    expect(generatedAddress).not.toBe(initialAddress);
    await gotoSection(page, 'Home');
    await gotoSection(page, 'Receive');
    await expect(address).toHaveValue(generatedAddress);

    await releaseHold(page);
    await expect.poll(() => page.evaluate(
        () => window.__xchainRaceProbe.completed['receive.getAddress'] || 0,
    )).toBe(1);
    await expect(address).toHaveValue(generatedAddress);
    await expect(page.getByDisplayValue(STALE_GENERATED_ADDRESS)).toHaveCount(0);
});
