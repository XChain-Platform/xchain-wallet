// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    expect,
    test,
    createWallet,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

const EXTERNAL_COSIGNERS = [
    {
        name: 'Travel key',
        pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        fingerprint: 'a1b2c3d4',
        derivationPath: "m/48'/0'/0'/2'/0/1",
    },
    {
        name: 'Recovery key',
        pubkey: '02c6047f9441ed7d6d3045406e95c07cd85a95c778e4b8cef3ca7abac09b95c709',
        fingerprint: 'e5f60718',
        derivationPath: "m/48'/0'/0'/2'/0/2",
    },
];

const ACTION_SUMMARY = 'Send 0.125 BTC · Network fee 0.00001 BTC';

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectNoHorizontalOverflow(page, label) {
    await settle(page);
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document scrolls sideways (${scrollWidth}px of content in ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectInlineControlHeights(page, label, { requireRow = false } = {}) {
    const rows = await page.getByRole('main').evaluate((main) => {
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const visibleButtons = [...Array.from(main.querySelectorAll('button')).filter((el) => !el.closest('[aria-hidden="true"]'))]
            .filter((button) => {
                const rect = button.getBoundingClientRect();
                const style = getComputedStyle(button);
                return rect.width > 0 && rect.height > 0
                    && style.display !== 'none' && style.visibility !== 'hidden';
            });
        const byParent = new Map();
        for (const button of visibleButtons) {
            const siblings = byParent.get(button.parentElement) || [];
            siblings.push(button);
            byParent.set(button.parentElement, siblings);
        }

        const result = [];
        for (const buttons of byParent.values()) {
            if (buttons.length < 2) continue;
            const lines = [];
            for (const button of buttons) {
                const rect = button.getBoundingClientRect();
                let line = lines.find((candidate) => Math.abs(candidate.top - rect.top) <= 2);
                if (!line) {
                    line = { top: rect.top, controls: [] };
                    lines.push(line);
                }
                line.controls.push({
                    name: button.getAttribute('aria-label') || button.textContent.trim(),
                    height: rect.height,
                });
            }
            result.push(...lines.filter((line) => line.controls.length > 1));
        }
        return result;
    });

    if (requireRow) {
        expect(rows.length, `${label}: no shared-line control row was rendered`).toBeGreaterThan(0);
    }
    for (const row of rows) {
        const heights = row.controls.map((control) => control.height);
        expect(
            Math.max(...heights) - Math.min(...heights),
            `${label}: shared-line controls have mismatched heights ${JSON.stringify(row.controls)}`,
        ).toBeLessThanOrEqual(2);
    }
}

async function expectScreen(page, viewport, heading, options = {}) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, `${heading} at ${viewport.width}x${viewport.height}`);
    await expectInlineControlHeights(
        page,
        `${heading} at ${viewport.width}x${viewport.height}`,
        options,
    );
}

async function openCommand(page, name) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(name);
    await palette.getByRole('option', { name: new RegExp(`^${name}`) }).first().click();
}

async function fillExternalHardware(row, cosigner) {
    await row.getByLabel('Name', { exact: true }).fill(cosigner.name);
    await row.getByLabel('Origin', { exact: true }).selectOption('external-hardware');
    await row.getByLabel('Public key (hex, 33-byte compressed)', { exact: true })
        .fill(cosigner.pubkey);
    await row.getByLabel('Master fingerprint (4 bytes hex)', { exact: true })
        .fill(cosigner.fingerprint);
    await row.getByLabel('Derivation path', { exact: true }).fill(cosigner.derivationPath);
}

async function createSigningSession(page) {
    return page.evaluate(async (actionSummary) => {
        const messaging = await import('/src/messaging.js');
        const wallets = await messaging.listWallets();
        const wallet = wallets.find((candidate) => candidate.multisigs?.length > 0);
        if (!wallet) throw new Error('The UI did not persist a multisig configuration.');
        const config = wallet.multisigs[0];
        return messaging.startMultisigSigningSession({
            walletId: wallet.id,
            // A stored multisig config carries no chain; the demo wallet's Bitcoin
            // chain is regtest.
            chainId: 'bitcoin-regtest',
            multisigConfigId: config.id,
            msgHash: '11'.repeat(32),
            psbtHex: '',
            actionSummary,
        });
    }, ACTION_SUMMARY);
}

test.describe('multisig flow', () => {
    test('creates a 2-of-3 setup and opens cosigner and signing views responsively', async ({ page }) => {
        await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
        // Demo wallets hide create and multisig commands, so this walk
        // uses a real dev wallet.
        await createWallet(page);
        await openCommand(page, 'Create multisig');

        const createForm = page.getByRole('form', { name: 'Create multisig' });
        await expect(createForm).toBeVisible();

        const share = page.getByRole('region', { name: 'Share this wallet as a cosigner' });
        await share.locator('summary').click();
        await share.getByLabel('Address to share').selectOption({ index: 1 });
        // The share details are offered as a QR code and a copy action; the
        // page shows no textarea repeating their raw text.
        await expect(share.getByRole('img', { name: 'QR code for multisig cosigner share details' })).toBeVisible();
        await expect(share.getByRole('button', { name: /Copy cosigner share details/ })).toBeVisible();

        for (const viewport of VIEWPORTS) {
            await test.step(`${viewport.name}: create and cosigner share`, async () => {
                await expectScreen(page, viewport, 'Create multisig');
                await expect(page.getByRole('heading', {
                    name: 'Share this wallet as a cosigner',
                    exact: true,
                })).toBeVisible();
                await expectNoHorizontalOverflow(
                    page,
                    `cosigner share at ${viewport.width}x${viewport.height}`,
                );
            });
        }

        const local = createForm.getByRole('group', { name: 'Cosigner 1', exact: true });
        await local.getByLabel('Use one of this wallet\'s addresses', { exact: true })
            .selectOption({ index: 1 });
        await expect(local.getByLabel('Public key (hex, 33-byte compressed)', { exact: true }))
            .toHaveValue(/^(02|03)[0-9a-f]{64}$/i);
        await expect(local.getByLabel('Master fingerprint (4 bytes hex)', { exact: true }))
            .toHaveValue(/^[0-9a-f]{8}$/i);

        const second = createForm.getByRole('group', { name: 'Cosigner 2', exact: true });
        await fillExternalHardware(second, EXTERNAL_COSIGNERS[0]);
        await createForm.getByRole('button', { name: '+ Add cosigner', exact: true }).click();
        const third = createForm.getByRole('group', { name: 'Cosigner 3', exact: true });
        await fillExternalHardware(third, EXTERNAL_COSIGNERS[1]);
        await expect(createForm.getByLabel('Threshold (1..3)', { exact: true })).toHaveValue('2');
        await expect(createForm.getByRole('button', { name: 'Review', exact: true })).toBeEnabled();

        for (const viewport of VIEWPORTS) {
            await test.step(`${viewport.name}: review`, async () => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await createForm.getByRole('button', { name: 'Review', exact: true }).click();

                const review = page.getByRole('form', { name: 'Review multisig' });
                await expect(review).toBeVisible();
                const reviewScrollTop = await page.getByRole('main')
                    .evaluate((main) => main.scrollTop);
                expect(reviewScrollTop, 'the review screen did not open at the top')
                    .toBeLessThanOrEqual(1);
                await expect(review).toContainText('2-of-3 SegWit multi-signature (lower fees)');
                await expect(review.locator('fieldset')).toHaveCount(3);
                await expectScreen(page, viewport, 'Review multisig', { requireRow: true });

                if (viewport !== VIEWPORTS.at(-1)) {
                    await review.getByRole('button', { name: 'Edit', exact: true }).click();
                    await expect(createForm).toBeVisible();
                }
            });
        }

        await page.getByRole('form', { name: 'Review multisig' })
            .getByRole('button', { name: 'Confirm multisig', exact: true }).click();
        await expect(page.getByText('Multisig configured', { exact: true })).toBeVisible();

        const session = await createSigningSession(page);
        expect(session.threshold).toBe(2);
        expect(session.cosignerPubkeys).toHaveLength(3);

        await openCommand(page, 'Multisig signing');
        const sessions = page.getByRole('list', { name: 'Multisig sessions' });
        await expect(sessions).toBeVisible();

        for (const viewport of VIEWPORTS) {
            await test.step(`${viewport.name}: signing session`, async () => {
                await expectScreen(page, viewport, 'Multisig signing sessions');
                const sessionRow = sessions.getByRole('button').filter({ hasText: ACTION_SUMMARY });
                await expect(sessionRow).toHaveCount(1);
                await sessionRow.click();

                await expectScreen(page, viewport, 'Multisig signing');
                await expect(page.getByRole('main')).toContainText(ACTION_SUMMARY);
                await expect(page.getByLabel('Multisig signing progress')).toHaveText(
                    'Signatures collected: 0 of 2',
                );
                await page.getByRole('main')
                    .getByRole('button', { name: 'Back to sessions', exact: true }).click();
                await expect(sessions).toBeVisible();
            });
        }
    });
});
