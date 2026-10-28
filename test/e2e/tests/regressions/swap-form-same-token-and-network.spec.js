// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Swap tokens on the dev mock: the same token on both sides is refused before
// any review is prepared, and a network change starts the chain-scoped terms
// over so a token, amount or list picked on one chain never reaches another.

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import { selectNamedToken } from '../../fixtures/crossChain.js';

const BTC = { chainId: 'bitcoin-mainnet', chainLabel: 'Bitcoin' };

async function pickNetwork(main, name, ticker) {
    const trigger = main.getByRole('button', { name: /^Give and get network:/ });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    if (await trigger.getAttribute('aria-label') === `Give and get network: ${name}`) return;
    await trigger.click();
    await main.getByRole('option', { name: new RegExp(`^${name}\\s*${ticker}$`) }).click();
    await expect(trigger).toHaveAttribute('aria-label', `Give and get network: ${name}`);
}

test('refuses the same token on both sides and clears terms on a network change', async ({ page }) => {
    await createWallet(page);
    await openPaletteCommand(page, 'Swap');
    const main = page.getByRole('main');
    await pickNetwork(main, 'Bitcoin', 'BTC');

    await selectNamedToken(page, 'Give token', { ...BTC, tick: 'PEPECASH' });
    await selectNamedToken(page, 'Get token', { ...BTC, tick: 'PEPECASH' });
    await main.getByRole('textbox', { name: /^Give amount/ }).fill('1');
    await main.getByRole('textbox', { name: /^Get amount/ }).fill('2');
    await expect(main.getByText('Give and get tickers must differ.')).toBeVisible();
    await main.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByTestId('action-intent')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Review', exact: true })).toBeEnabled();

    await selectNamedToken(page, 'Get token', { ...BTC, tick: 'XCP' });
    await expect(main.getByText('Give and get tickers must differ.')).toHaveCount(0);
    await main.getByRole('textbox', { name: /^Get amount/ }).fill('3');

    await pickNetwork(main, 'Litecoin', 'LTC');
    await expect(main.getByRole('button', { name: /^Give token:/ })).toHaveAccessibleName(/^Give token:\s*Select a token/);
    await expect(main.getByRole('button', { name: /^Get token:/ })).toHaveAccessibleName(/^Get token:\s*Select a token/);
    await expect(main.getByRole('textbox', { name: /^Give amount/ })).toHaveValue('');
    await expect(main.getByRole('textbox', { name: /^Get amount/ })).toHaveValue('');
});
