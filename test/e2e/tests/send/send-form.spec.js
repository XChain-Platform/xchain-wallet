// Send form UX — §29. Exercises everything up to the broadcast
// attempt, which against the dev-SDK stub surfaces as a visible
// error banner. A sibling spec that actually signs + broadcasts
// lands once the real xchain-sdk is bundled into the web shell.

import { expect, test } from '@playwright/test';

test.describe('send form', () => {
    test.beforeEach(async ({ page }) => {
        // Seed a wallet per test — each browser context starts with
        // empty IDB, so we create fresh every time.
        await page.goto('/');
        await page.getByRole('button', { name: 'Create a new wallet' }).click();
        await page.getByLabel('Password', { exact: true }).fill('sendpassword123');
        await page.getByLabel('Confirm password').fill('sendpassword123');
        await page.getByRole('button', { name: 'Next' }).click();
        await page.getByLabel(/i have written down/i).check();
        await page.getByRole('button', { name: 'Create wallet' }).click();
        await expect(
            page.getByRole('button', { name: 'Lock' }),
        ).toBeVisible({ timeout: 60_000 });
    });

    test('review + back preserves form state', async ({ page }) => {
        await page.getByRole('button', { name: 'Send' }).click();

        // Form stage
        await page.getByLabel('To').fill('bc1qtestrecipient00000000000000000000000000');
        await page.getByLabel('Amount').fill('0.01');
        await page.getByLabel('Memo').fill('e2e test');
        await page.getByRole('button', { name: 'Review' }).click();

        // Review stage — summary rows present
        await expect(page.getByText('Review')).toBeVisible();
        await expect(page.getByText('bc1qtestrecipient', { exact: false })).toBeVisible();
        await expect(page.getByText('e2e test')).toBeVisible();

        // Back keeps the form state
        await page.getByRole('button', { name: 'Back' }).click();
        await expect(page.getByLabel('To')).toHaveValue(
            'bc1qtestrecipient00000000000000000000000000',
        );
        await expect(page.getByLabel('Memo')).toHaveValue('e2e test');
    });

    test('protocol-forbidden memo characters are rejected', async ({ page }) => {
        await page.getByRole('button', { name: 'Send' }).click();

        await page.getByLabel('To').fill('bc1qrecipient0000000000000000000000000000000');
        await page.getByLabel('Amount').fill('1');
        await page.getByLabel('Memo').fill('a|b');
        await page.getByRole('button', { name: 'Review' }).click();

        await expect(page.getByRole('alert')).toHaveText(/memo cannot contain/i);
    });

    test('zero amount is rejected', async ({ page }) => {
        await page.getByRole('button', { name: 'Send' }).click();

        await page.getByLabel('To').fill('bc1qrecipient0000000000000000000000000000000');
        await page.getByLabel('Amount').fill('0');
        await page.getByRole('button', { name: 'Review' }).click();

        await expect(page.getByRole('alert')).toHaveText(/positive/i);
    });

    test('broadcast attempt surfaces SDK-stub error instead of hanging', async ({ page }) => {
        await page.getByRole('button', { name: 'Send' }).click();

        await page.getByLabel('To').fill('bc1qrecipient0000000000000000000000000000000');
        await page.getByLabel('Amount').fill('0.001');
        await page.getByRole('button', { name: 'Review' }).click();

        // At Review: enter password + hit Send.
        await page.getByLabel('Password').fill('sendpassword123');
        await page.getByRole('button', { name: 'Send' }).click();

        // Stub SDK errors at the encoder — surfaced inline, not a hang.
        await expect(page.getByRole('alert')).toContainText(
            /xchain-sdk|not yet wired|encoder|createAction/i,
            { timeout: 30_000 },
        );
    });
});
