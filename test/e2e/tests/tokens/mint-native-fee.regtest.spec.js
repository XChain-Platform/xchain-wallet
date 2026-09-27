import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_TICKER,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const XCHAIN_AMOUNT = 20;
const STAMP = Date.now().toString().slice(-7);
const TICK = `MNF${STAMP}`;
const INITIAL_MINT = 100;
const MINT_AMOUNT = 25;

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function approveAndReadTxid(page) {
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
    expect(txid, 'the action result showed no transaction id').toBeTruthy();
    return txid;
}

// MINT has no gas-schedule entry: /feequote?action=MINT answers xchainFee 0 and
// requiredFeeNative 0 on RBTC, RLTC and RDOGE alike. Paying the protocol fee in
// the native coin therefore has to produce a valid MINT with NO fee output, since
// applyNativeFeePreflight builds none for a zero quote. The spec pins that
// behaviour rather than a positive fee the chain never charges.
function nativeFeeToggle(scope) {
    const name = new RegExp(`^Pay protocol fee in ${REGTEST_TICKER} instead of XCHAIN`);
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

test.describe(`MINT native-fee payment on ${REGTEST_CHAIN_LABEL} regtest`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_200_000);

    test('the Mint form pays in the native coin and the zero-fee MINT lands with no fee output', async ({ page }) => {
        let source;

        await test.step('onboard and fund both fee lanes', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Native Fee Mint Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, 1);
            await mintXchain(page, XCHAIN_AMOUNT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_AMOUNT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('issue a mintable token through the real form', async () => {
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill('1000');
            await main.getByLabel('Initial mint (optional)').fill(String(INITIAL_MINT));
            await main.getByLabel('Max mint per transaction (optional)').fill('100');
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(page, 'the ISSUE');
            const issued = await waitForValidAction(await approveAndReadTxid(page));
            expect(issued.action).toBe('ISSUE');
            await waitForTokenBalance(source, TICK, INITIAL_MINT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('enable native-fee payment and approve the composed MINT', async () => {
            await gotoPalette(page, 'Mint supply');
            const main = page.getByRole('main');
            await expect(main.getByRole('textbox', { name: /^Amount/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByRole('button', { name: /^Token:/ }).click();
            await page.getByLabel('Search coins or tokens').fill(TICK);
            await page.getByLabel(new RegExp(`Open ${TICK} details`, 'i')).first().click();
            await main.getByRole('textbox', { name: /^Amount/ }).fill(String(MINT_AMOUNT));

            if (REGTEST_COIN === 'RBTC') {
                // Bitcoin keeps an XCHAIN fee lane, so paying in BTC is a choice.
                const toggle = nativeFeeToggle(main);
                await expect(toggle, 'the Mint form has no native-fee toggle').toBeVisible();
                if (!(await toggle.isChecked())) await toggle.click();
                await expect(toggle).toBeChecked();
            } else {
                // LTC and DOGE have no XCHAIN fee lane, so the row is a statement.
                await expect(main.getByText(`Protocol fees are paid in ${REGTEST_TICKER}`, { exact: true }))
                    .toBeVisible();
            }
            await main.getByRole('button', { name: 'Mint', exact: true }).click();
            await expectConfirmModal(page, 'the MINT');
        });

        await test.step('the indexed MINT is valid and carries no native fee output', async () => {
            const txid = await approveAndReadTxid(page);
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('MINT');
            expect(String(action.tx_data)).toContain(`MINT|0|${TICK}|${MINT_AMOUNT}`);
            expect(Number(action.fee?.native_coin_amount ?? 0),
                'MINT is unpriced, so a native fee output means the wallet paid a fee nobody charged')
                .toBe(0);
            await waitForTokenBalance(source, TICK, INITIAL_MINT + MINT_AMOUNT);
            expect(await tokenBalance(source, TICK)).toBe(INITIAL_MINT + MINT_AMOUNT);
        });
    });
});
