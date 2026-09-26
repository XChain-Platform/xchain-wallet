import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const XCHAIN_AMOUNT = 20;
const MEMO = `ADP${Date.now().toString().slice(-8)}`;

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

async function readTxid(page) {
    const main = page.getByRole('main');
    await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
    expect(txid, 'the preferences result showed no transaction id').toBeTruthy();
    return txid;
}

test.describe('ADDRESS v0 preferences on regtest', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('the preferences form writes all three values to the indexed ADDRESS row', async ({ page }) => {
        let source;

        await test.step('onboard and fund both fee lanes', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Address Preferences Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, 1);
            await mintXchain(page, XCHAIN_AMOUNT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_AMOUNT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('submit changed preferences through the address detail form', async () => {
            await gotoPalette(page, 'Addresses');
            const main = page.getByRole('main');
            await main.getByRole('button', { name: `View address ${source}` }).click();
            await main.getByRole('button', { name: 'Edit on-chain preferences' }).click();

            // The screen title sits in the page banner, outside main.
            await expect(page.getByRole('banner').getByText('On-chain preferences', { exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await main.getByRole('radio', { name: 'Destroy the fee (reduces supply)' }).check();
            await main.getByRole('checkbox', {
                name: 'Require a memo on any send to this address',
            }).check();
            await main.getByRole('radio', {
                name: 'Anyone may open a dispenser funded by this address',
            }).check();
            await main.getByLabel('Memo (optional)').fill(MEMO);
            await main.getByRole('button', { name: 'Review', exact: true }).click();

            await expect(main).toContainText('Destroy the fee (reduces supply) - CHANGED');
            await expect(main).toContainText('Memo required on incoming sends - CHANGED');
            await expect(main).toContainText('Anyone may open a dispenser here - CHANGED');
            await main.getByRole('button', { name: 'Sign & broadcast', exact: true }).click();
        });

        await test.step('read the exact ADDRESS row back from the explorer', async () => {
            const txid = await readTxid(page);
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('ADDRESS');
            expect(String(action.tx_data)).toContain(`ADDRESS|0|1|1|2|${MEMO}`);

            const response = await explorerJson(`addresses/${source}/address`);
            const rows = Array.isArray(response) ? response : response?.data || [];
            const row = rows.find((candidate) => candidate.tx_hash === txid);
            expect(row, `the explorer returned no ADDRESS row for ${txid}`).toBeTruthy();
            expect(String(row.status)).toBe('valid');
            expect(Number(row.fee_preference)).toBe(1);
            expect(Number(row.require_memo)).toBe(1);
            expect(Number(row.dispenser_preference)).toBe(2);
            expect(String(row.memo)).toBe(MEMO);
        });
    });
});
