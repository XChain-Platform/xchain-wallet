// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const LIST_INDEX = '700001';
const LIST_NAME = 'Road trip';
const LIST_MEMBER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SECOND_MEMBER = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const TRANSFER_DESTINATION = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const VIEWPORTS = [
    { width: 412, height: 869 },
    { width: 1280, height: 800 },
];

function describedListAction(params) {
    const version = String(params?.VERSION ?? '0');
    const items = Array.isArray(params?.ITEM) ? params.ITEM.map(String) : [];
    const details = [];
    let summary = 'Review list action';

    if (version === '0' || version === '4') {
        summary = `Create ${String(params.TYPE) === '1' ? 'token' : 'address'} list`;
        details.push(
            { label: 'Type', value: String(params.TYPE) === '1' ? 'Token list' : 'Address list' },
            { label: 'Items', value: items.join(', ') },
        );
        if (params.NAME) details.push({ label: 'Name', value: String(params.NAME) });
        if (params.DESCRIPTION) details.push({ label: 'Description', value: String(params.DESCRIPTION) });
    } else if (version === '1') {
        summary = `Fork list #${params.LIST_ACTION_INDEX}`;
        details.push(
            { label: 'List', value: `#${params.LIST_ACTION_INDEX}` },
            { label: 'Edit', value: String(params.EDIT) === '2' ? 'Remove' : 'Add' },
            { label: 'Items', value: items.join(', ') },
        );
    } else if (version === '2') {
        summary = `Share list #${params.LIST_ACTION_INDEX}`;
        details.push({ label: 'List', value: `#${params.LIST_ACTION_INDEX}` });
    } else if (version === '3') {
        summary = `Transfer list #${params.LIST_ACTION_INDEX}`;
        details.push(
            { label: 'List', value: `#${params.LIST_ACTION_INDEX}` },
            { label: 'Destination', value: String(params.DESTINATION) },
        );
    } else if (version === '5') {
        summary = `Rename list #${params.LIST_ACTION_INDEX}`;
        details.push(
            { label: 'List', value: `#${params.LIST_ACTION_INDEX}` },
            { label: 'Name', value: String(params.NAME) },
            { label: 'Description', value: String(params.DESCRIPTION) },
        );
    }
    if (params?.MEMO) details.push({ label: 'Memo', value: String(params.MEMO) });
    return { summary, details, warnings: [] };
}

async function installListFixtures(page) {
    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `const sendMessage = async (type, request) => {
    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);
};`;
        const replacement = `let e2eListOwner = null;
const sendMessage = async (type, request) => {
    if (type === 'sdk.getActionFormats' && request?.action === 'LIST') {
        return { 0: 'create', 1: 'edit', 2: 'share', 3: 'transfer', 4: 'create-meta', 5: 'rename' };
    }
    if (type === 'lists.forSource') {
        if (request?.chainId !== 'bitcoin-mainnet') return [];
        if (!e2eListOwner) e2eListOwner = request.address;
        if (request.address !== e2eListOwner) return [];
        return { data: [{
            action: 'LIST', action_format: 0, action_index: '${LIST_INDEX}',
            block_index: 840001, name: '${LIST_NAME}', source: e2eListOwner,
            status: 'valid', type: '2',
        }] };
    }
    if (type === 'lists.byActionIndex' && String(request?.actionIndex) === '${LIST_INDEX}') {
        return {
            action: 'LIST', action_format: 0, action_index: '${LIST_INDEX}',
            block_index: 840001, description: 'Addresses for the summer drive',
            edits: [], list: ['${LIST_MEMBER}', '${SECOND_MEMBER}'], name: '${LIST_NAME}',
            source: e2eListOwner, status: 'valid', type: '2',
            state: {
                current_list: ['${LIST_MEMBER}', '${SECOND_MEMBER}'],
                edit_resolution_active: true, membership_action_index: '${LIST_INDEX}',
                owner: e2eListOwner,
            },
        };
    }
    if (type === 'lists.shared') return { lists: [], unavailable: [] };
    const { sendMessage: sendToHost } = await loadHostBridge();
    const result = await sendToHost(type, request);
    if (type === 'action.composeForConfirm' && request?.actionData?.action === 'LIST') {
        return { ...result, decoded: (${describedListAction.toString()})(request.actionData.params) };
    }
    return result;
};`;
        expect(source, 'the web messaging seam changed').toContain(original);
        await route.fulfill({ response, body: source.replace(original, replacement) });
    });
}

async function mismatchedInlineControlHeights(page) {
    return page.evaluate(() => {
        const selector = [
            'button',
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])',
            'select',
            'textarea',
            '[role="button"]',
            '[role="combobox"]',
        ].join(', ');
        const controls = [...new Set(document.querySelectorAll(selector))]
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return rect.width > 0 && rect.height > 0
                    && style.display !== 'none' && style.visibility !== 'hidden';
            });
        const label = (element) => (
            element.getAttribute('aria-label')
            || element.textContent
            || element.getAttribute('name')
            || element.tagName
        ).trim().replace(/\s+/g, ' ').slice(0, 60);
        const commonAncestor = (left, right) => {
            const leftAncestors = new Set();
            for (let node = left.parentElement; node; node = node.parentElement) leftAncestors.add(node);
            for (let node = right.parentElement; node; node = node.parentElement) {
                if (leftAncestors.has(node)) return node;
            }
            return null;
        };
        const mismatches = [];
        for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
            const left = controls[leftIndex];
            const leftRect = left.getBoundingClientRect();
            for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
                const right = controls[rightIndex];
                if (left.contains(right) || right.contains(left)) continue;
                const rightRect = right.getBoundingClientRect();
                if (Math.abs(leftRect.top - rightRect.top) > 2) continue;
                if (leftRect.right > rightRect.left + 1 && rightRect.right > leftRect.left + 1) continue;
                const ancestor = commonAncestor(left, right);
                if (!ancestor || !/(flex|grid)/.test(getComputedStyle(ancestor).display)) continue;
                const difference = Math.abs(leftRect.height - rightRect.height);
                if (difference <= 2) continue;
                mismatches.push({
                    controls: [label(left), label(right)],
                    heights: [Math.round(leftRect.height), Math.round(rightRect.height)],
                });
            }
        }
        return mismatches;
    });
}

async function expectListScreen(page, heading, label) {
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
        overflow.scrollWidth,
        `${label}: document width ${overflow.scrollWidth}px exceeds ${overflow.clientWidth}px`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(
        await mismatchedInlineControlHeights(page),
        `${label}: controls sharing a line differ in height by more than 2px`,
    ).toEqual([]);
}

async function scrollScreenToEnd(page) {
    await page.getByRole('main').evaluate((main) => { main.scrollTop = main.scrollHeight; });
}

async function expectReviewAtTop(page, label) {
    const scroll = await page.evaluate(() => ({
        document: document.scrollingElement?.scrollTop || 0,
        main: document.querySelector('main')?.scrollTop || 0,
    }));
    expect(scroll, `${label}: review did not open at the top`).toEqual({ document: 0, main: 0 });
}

async function expectReview(page, label, values) {
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await expectListScreen(page, 'Confirm', label);
    await expectReviewAtTop(page, label);
    const intent = page.getByTestId('action-intent');
    await expect(intent).toBeVisible();
    for (const value of values) await expect(intent).toContainText(value);
}

async function goBack(page) {
    await page.getByRole('button', { name: 'Back to previous screen', exact: true }).click();
}

async function chooseBitcoin(page) {
    const network = page.locator('button[aria-label^="Network:"]');
    await expect(network).toBeVisible();
    if (!/Bitcoin/.test(await network.getAttribute('aria-label'))) {
        await network.click();
        await page.getByRole('option', { name: /^Bitcoin\b/ }).click();
    }
}

for (const viewport of VIEWPORTS) {
    test(`list flows render and review at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.slow();
        await installListFixtures(page);
        await page.setViewportSize(viewport);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await gotoSection(page, 'Lists');

        const listRow = page.getByRole('button', {
            name: `Open ${LIST_NAME} (List #${LIST_INDEX})`,
            exact: true,
        });
        await expect(listRow).toBeVisible();
        await expectListScreen(page, 'My lists', 'My lists');

        await page.getByRole('button', { name: 'Create list', exact: true }).first().click();
        await expect(page.getByLabel('Addresses', { exact: true })).toBeVisible();
        await expectListScreen(page, 'Create list', 'Create list');
        await chooseBitcoin(page);
        await page.getByLabel('Addresses', { exact: true }).fill(LIST_MEMBER);
        await page.getByLabel('Name (optional)', { exact: true }).fill('Conference guests');
        await page.getByLabel('Description (optional)', { exact: true }).fill('People to meet in Seattle');
        await page.getByLabel('Memo (optional)', { exact: true }).fill('create-review');
        await scrollScreenToEnd(page);
        await page.getByRole('form', { name: 'Create list' })
            .getByRole('button', { name: 'Publish list', exact: true }).click();
        await expectReview(page, 'Create list review', [
            'Create address list', 'Conference guests', 'People to meet in Seattle',
            LIST_MEMBER, 'create-review',
        ]);
        await page.getByTestId('confirm-reject').click();
        await expectListScreen(page, 'Create list', 'Create list after review');
        await goBack(page);

        await expect(listRow).toBeVisible();
        await expectListScreen(page, 'My lists', 'My lists after create');
        await listRow.click();
        await expect(page.getByRole('button', { name: 'Rename list', exact: true })).toBeVisible();
        await expectListScreen(page, 'Address list', 'List detail');

        await page.getByRole('button', { name: 'Fork & edit', exact: true }).click();
        await expect(page.getByRole('form', { name: 'Edit list' })).toBeVisible();
        await expectListScreen(page, 'Edit list', 'Fork list');
        await page.getByRole('checkbox', { name: LIST_MEMBER, exact: true }).uncheck();
        await page.getByLabel('Memo (optional)', { exact: true }).fill('fork-review');
        await scrollScreenToEnd(page);
        await page.getByRole('form', { name: 'Edit list' })
            .getByRole('button', { name: 'Review', exact: true }).click();
        await expectListScreen(page, 'Review list edit', 'Fork list review');
        await expectReviewAtTop(page, 'Fork list review');
        const forkReview = page.getByRole('form', { name: 'Review list edit' });
        await expect(forkReview).toContainText(`${LIST_NAME} (List #${LIST_INDEX})`);
        await expect(forkReview).toContainText('Removing');
        await expect(forkReview).toContainText('1 item');
        await expect(forkReview).toContainText('fork-review');
        await forkReview.getByRole('button', { name: 'Back', exact: true }).click();
        await expectListScreen(page, 'Edit list', 'Fork list after review');
        await goBack(page);

        await expect(page.getByRole('button', { name: 'Rename list', exact: true })).toBeVisible();
        await expectListScreen(page, 'Address list', 'List detail before rename');
        await page.getByRole('button', { name: 'Rename list', exact: true }).click();
        await expect(page.getByLabel('Name (empty means unchanged)', { exact: true })).toBeVisible();
        await expectListScreen(page, 'Rename list', 'Rename list');
        await page.getByLabel('Name (empty means unchanged)', { exact: true }).fill('Pacific trip');
        await page.getByLabel('Description (empty means unchanged)', { exact: true }).fill('Updated travel contacts');
        await page.getByLabel('Memo (optional)', { exact: true }).fill('rename-review');
        await scrollScreenToEnd(page);
        await page.getByRole('form', { name: 'Rename list' })
            .getByRole('button', { name: 'Review', exact: true }).click();
        await expectReview(page, 'Rename list review', [
            `Rename list #${LIST_INDEX}`, 'Pacific trip', 'Updated travel contacts', 'rename-review',
        ]);
        await page.getByTestId('confirm-reject').click();
        await expectListScreen(page, 'Rename list', 'Rename list after review');
        await goBack(page);

        await expect(page.getByRole('button', { name: 'Share list', exact: true })).toBeVisible();
        await expectListScreen(page, 'Address list', 'List detail before share');
        await page.getByRole('button', { name: 'Share list', exact: true }).click();
        await expect(page.getByLabel('Type SHARE to confirm', { exact: true })).toBeVisible();
        await expectListScreen(page, 'Share list', 'Share list');
        await page.getByLabel('Memo (optional)', { exact: true }).fill('share-review');
        await page.getByLabel('Type SHARE to confirm', { exact: true }).fill('SHARE');
        await scrollScreenToEnd(page);
        await page.getByRole('form', { name: 'Share list' })
            .getByRole('button', { name: 'Review', exact: true }).click();
        await expectReview(page, 'Share list review', [
            `Share list #${LIST_INDEX}`, 'share-review',
        ]);
        await page.getByTestId('confirm-reject').click();
        await expectListScreen(page, 'Share list', 'Share list after review');
        await goBack(page);

        await expect(page.getByRole('button', { name: 'Transfer list', exact: true })).toBeVisible();
        await expectListScreen(page, 'Address list', 'List detail before transfer');
        await page.getByRole('button', { name: 'Transfer list', exact: true }).click();
        await expect(page.getByLabel('Destination', { exact: true })).toBeVisible();
        await expectListScreen(page, 'Transfer list', 'Transfer list');
        await page.getByLabel('Destination', { exact: true }).fill(TRANSFER_DESTINATION);
        await page.getByLabel('Memo (optional)', { exact: true }).fill('transfer-review');
        await page.getByLabel('Type TRANSFER to confirm', { exact: true }).fill('TRANSFER');
        await scrollScreenToEnd(page);
        await page.getByRole('form', { name: 'Transfer list' })
            .getByRole('button', { name: 'Review', exact: true }).click();
        await expectReview(page, 'Transfer list review', [
            `Transfer list #${LIST_INDEX}`, TRANSFER_DESTINATION, 'transfer-review',
        ]);
    });
}
