import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_CHAIN_LABEL,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const XCHAIN_AMOUNT = 20;
const MEMO = `SLA${Date.now().toString().slice(-8)}`;

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
    expect(txid, 'the self-lock result showed no transaction id').toBeTruthy();
    return txid;
}

test.describe(`SLEEP v0 address self-lock on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('an indefinite address lock lands as an indexed SLEEP v0 row', async ({ page }) => {
        let source;

        await test.step('onboard and fund both fee lanes', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Address Sleep Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, 1);
            await mintXchain(page, XCHAIN_AMOUNT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_AMOUNT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('approve the address-mode form with its typed safety gate', async () => {
            await gotoPalette(page, 'All actions');
            const main = page.getByRole('main');
            await main.getByText('Lock this address', { exact: true }).first().click();
            // The screen title sits in the page banner, outside main.
            await expect(page.getByRole('banner').getByText('Lock address', { exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await expect(main.getByLabel('Address to lock')).toHaveValue(source);
            await main.getByRole('radio', { name: /Lock indefinitely/ }).check();
            await main.getByLabel('Memo (optional)').fill(MEMO);
            await main.getByRole('button', { name: 'Preview', exact: true }).click();

            await expect(main).toContainText('This locks your own address.');
            await main.getByLabel('Type SLEEP to confirm').fill('SLEEP');
            const approve = main.getByRole('button', {
                name: `Lock address on ${REGTEST_CHAIN_LABEL}`,
            });
            await expect(approve).toBeEnabled({ timeout: 30_000 });
            await approve.click();
        });

        await test.step('read the SLEEP v0 row back from the explorer', async () => {
            const txid = await readTxid(page);
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('SLEEP');
            expect(String(action.tx_data)).toContain(`SLEEP|0|-1|${MEMO}`);

            const response = await explorerJson(`sleeps/${source}/address`);
            const rows = Array.isArray(response) ? response : response?.data || [];
            const row = rows.find((candidate) => candidate.tx_hash === txid);
            expect(row, `the explorer returned no address SLEEP row for ${txid}`).toBeTruthy();
            expect(String(row.status)).toBe('valid');
            expect(String(row.resume_block ?? row.resumeBlock)).toBe('-1');
            expect(String(row.memo)).toBe(MEMO);
        });
    });
});
