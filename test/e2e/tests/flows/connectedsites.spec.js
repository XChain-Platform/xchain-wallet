// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
} from '../../fixtures/responsive.js';

const SITE = {
    schemaVersion: 1,
    id: 'connected-site-e2e',
    origin: 'https://test-site.example',
    appName: 'XChain Test Site',
    appIcon: '',
    connectedAt: '2026-10-12T17:00:00.000Z',
    lastUsedAt: '2026-10-13T17:00:00.000Z',
    permissions: {
        chains: ['bitcoin-mainnet', 'litecoin-mainnet'],
        accounts: ['demo-account-1'],
        canSignMessage: true,
        canSignAction: {
            SEND: 'always',
            SWEEP: 'never',
        },
    },
    sessionHistory: [],
};

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

async function installConnectedSitesFixture(page) {
    await page.addInitScript((site) => {
        globalThis.__connectedSitesE2E = {
            site,
            sites: [structuredClone(site)],
            deletedIds: [],
        };
    }, SITE);

    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;
        const replacement = `    const fixture = globalThis.__connectedSitesE2E;
    if (fixture && type === 'sites.list') return structuredClone(fixture.sites);
    if (fixture && type === 'sites.delete') {
        fixture.deletedIds.push(request?.id);
        fixture.sites = fixture.sites.filter((site) => site.id !== request?.id);
        return { ok: true };
    }
    if (fixture && type === 'sites.restore') {
        fixture.sites = [...fixture.sites.filter((site) => site.id !== request?.site?.id), structuredClone(request.site)];
        return { ok: true };
    }
    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;

        if (!source.includes(original)) {
            throw new Error('The web messaging seam changed; update the connected-sites fixture.');
        }
        await route.fulfill({ response, body: source.replace(original, replacement) });
    });
}

async function resetConnectedSitesFixture(page) {
    await page.evaluate((site) => {
        globalThis.__connectedSitesE2E.sites = [structuredClone(site)];
        globalThis.__connectedSitesE2E.deletedIds = [];
    }, SITE);
}

async function expectNoHorizontalOverflow(page, label) {
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document is ${scrollWidth}px wide in a ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + 1);

    const mainOverflow = await page.getByRole('main').evaluate((main) => ({
        scrollWidth: main.scrollWidth,
        clientWidth: main.clientWidth,
    }));
    expect(
        mainOverflow.scrollWidth,
        `${label}: main is ${mainOverflow.scrollWidth}px wide in a ${mainOverflow.clientWidth}px container`,
    ).toBeLessThanOrEqual(mainOverflow.clientWidth + 1);
}

async function expectSharedLineHeights(controls, label, { requireSharedLine = true } = {}) {
    const boxes = await controls.evaluateAll((nodes) => nodes
        .filter((node) => {
            const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((node) => {
            const box = node.getBoundingClientRect();
            return {
                name: (node.getAttribute('aria-label') || node.textContent || '').trim(),
                top: box.top,
                height: box.height,
            };
        }));

    const lines = [];
    for (const box of boxes) {
        const line = lines.find((candidate) => Math.abs(candidate[0].top - box.top) <= 2);
        if (line) line.push(box); else lines.push([box]);
    }
    const sharedLines = lines.filter((line) => line.length > 1);
    if (requireSharedLine) {
        expect(sharedLines.length, `${label}: no controls shared a rendered line`).toBeGreaterThan(0);
    }

    for (const line of sharedLines) {
        const heights = line.map((box) => box.height);
        const delta = Math.max(...heights) - Math.min(...heights);
        expect(
            delta,
            `${label}: ${line.map((box) => `${box.name} (${box.height}px)`).join(', ')}`,
        ).toBeLessThanOrEqual(2);
    }
}

test.describe('connected sites flow', () => {
    test('reviews permissions and revokes a connected site at phone and desktop sizes', async ({ page }) => {
        test.slow();
        await installConnectedSitesFixture(page);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        for (const [index, viewport] of VIEWPORTS.entries()) {
            await test.step(`${viewport.name}: connected site list, permissions, and revoke`, async () => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                if (index > 0) await gotoSection(page, 'Home');
                await resetConnectedSitesFixture(page);
                await openSettings(page);
                // Settings may reopen on the last sub-page, so step back to the landing first.
                await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toBeVisible();
                const landing = page.getByRole('heading', { level: 1, name: 'Settings', exact: true });
                for (let i = 0; i < 5 && !(await landing.isVisible().catch(() => false)); i += 1) {
                    await page.getByRole('banner').getByRole('button', { name: /^Back\b/ }).first().click();
                }
                await page.getByRole('main').getByRole('button', { name: /^Privacy and Sites\b/ }).click();

                const settingsMain = page.getByRole('main');
                const connectedSitesRow = settingsMain.getByRole('button', { name: /^Connected sites/ });
                await expect(connectedSitesRow).toContainText('1 connected');
                await connectedSitesRow.click();

                const main = page.getByRole('main');
                await expect(page.getByRole('heading', { level: 1, name: 'Connected Sites', exact: true })).toBeVisible();
                expect(
                    await main.evaluate((element) => element.scrollTop),
                    `${viewport.name}: Connected sites did not open at the top`,
                ).toBe(0);

                // A site row opens its detail page: identity, read-only permissions and the site actions.
                const siteRow = main.getByRole('list', { name: 'Allowed sites' })
                    .getByRole('button', { name: new RegExp(`^${SITE.appName}`) });
                await expect(siteRow).toContainText(SITE.origin);
                await expectNoHorizontalOverflow(page, `${viewport.name} connected sites list`);
                await siteRow.click();

                const identity = main.getByRole('region', { name: 'Site identity' });
                await expect(identity.getByRole('heading', { level: 2, name: SITE.appName })).toBeVisible();
                await expect(identity).toContainText(SITE.origin);
                const permissions = main.getByRole('list', { name: 'Permissions', exact: true });
                await expect(permissions).toContainText('bitcoin-mainnet, litecoin-mainnet');
                await expect(permissions).toContainText('demo-account-1');
                await expect(permissions.getByText('Always allow', { exact: true })).toHaveCount(2);
                await expect(permissions.getByText('Never allow', { exact: true })).toHaveCount(1);
                await expect(permissions.getByRole('listitem').filter({ hasText: 'Send' }).filter({ hasText: 'Always allow' })).toHaveCount(1);
                await expect(permissions.getByRole('listitem').filter({ hasText: 'Sweep' }).filter({ hasText: 'Never allow' })).toHaveCount(1);
                await expectNoHorizontalOverflow(page, `${viewport.name} site permissions`);
                const siteActions = main.getByRole('list', { name: 'Site actions' }).getByRole('button');
                await expectSharedLineHeights(siteActions, `${viewport.name} site actions`, { requireSharedLine: false });

                await main.getByRole('button', { name: 'Disconnect', exact: true }).click();
                const review = page.getByRole('dialog', { name: `Disconnect ${SITE.appName}?` });
                await expect(review).toBeVisible();
                await expect(review).toContainText(SITE.appName);
                await expect(review).toContainText(SITE.origin);

                const reviewScrollTops = await review.evaluate((dialog) => Array.from(dialog.querySelectorAll('*'))
                    .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
                    .map((element) => element.scrollTop));
                expect(reviewScrollTops.length, `${viewport.name}: revoke review has no scroll container`).toBeGreaterThan(0);
                expect(reviewScrollTops, `${viewport.name}: revoke review did not open at the top`)
                    .toEqual(reviewScrollTops.map(() => 0));

                await expectNoHorizontalOverflow(page, `${viewport.name} revoke review`);
                // The confirm dialog stacks its two actions full width on a phone, so
                // a shared line is only required where they sit side by side.
                await expectSharedLineHeights(review.getByRole('button'), `${viewport.name} revoke review actions`, {
                    requireSharedLine: viewport.name !== 'phone',
                });
                await review.getByRole('button', { name: 'Disconnect site' }).click();

                await expect(main.getByRole('list', { name: 'Allowed sites' })).toHaveCount(0);
                await expect(main.getByText('No sites connected yet', { exact: true })).toBeVisible();
                await expect(page.getByRole('heading', { level: 1, name: 'Connected Sites', exact: true })).toBeVisible();
                await expectNoHorizontalOverflow(page, `${viewport.name} revoked site list`);
                await expect.poll(() => page.evaluate(() => globalThis.__connectedSitesE2E.deletedIds))
                    .toEqual([SITE.id]);
            });
        }
    });
});
