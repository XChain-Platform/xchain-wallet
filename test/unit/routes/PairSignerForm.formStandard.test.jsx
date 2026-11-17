// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The standing UI rules on the Hardware Wallet connect flow: one green main
// action with an icon per step, Back instead of Cancel, no radio buttons, at
// most four tabs, no card inside a card, and plain copy with no em-dash.

import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import formPageStyles from '../../../packages/core/src/ui/FormPage.module.css';
import { MockHardwareSigner } from '../signers/MockHardwareSigner.js';

const PAIRING_INFO = {
    vendor: 'trezor',
    model: 'T3T1',
    deviceIdentifier: 'device-1',
    firmwareVersion: '2.8.7',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

async function reach(stepName) {
    const signer = new MockHardwareSigner({ vendor: 'trezor' });
    const utils = render(
        <MessagingProvider shell="web" messaging={{ addHardwareWallet: vi.fn() }}>
            <PairSignerForm
                mode="add"
                pairTrezor={vi.fn(async () => ({ signer, pairingInfo: PAIRING_INFO }))}
                pairLedger={null}
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
    if (stepName === 'choose') return utils;
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));
    });
    if (stepName === 'connect') return utils;
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    return utils;
}

describe('Hardware Wallet connect flow on the standing UI rules', () => {
    it.each([
        ['connect', 'Continue', 'button'],
        ['accounts', 'Add Wallet', 'submit'],
    ])('step %s has one green %s button with an icon and no Cancel', async (stepName, label, type) => {
        await reach(stepName);

        const main = screen.getByRole('button', { name: label });
        expect(main).toHaveAttribute('type', type);
        expect(main).toHaveClass(buttonStyles.success);
        expect(main.querySelector('svg')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeEnabled();
    });

    it.each(['choose', 'connect', 'accounts'])('step %s draws no radio button and no card inside a card', async (stepName) => {
        const { container } = await reach(stepName);

        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        expect(container.querySelector('input[type="radio"]')).toBeNull();
        const card = container.querySelector('[data-hardware-device-card]');
        if (card) expect(card.parentElement.closest('[data-hardware-device-card]')).toBeNull();
    });

    it.each(['choose', 'connect', 'accounts'])('step %s uses the responsive FormPage card', async (stepName) => {
        await reach(stepName);

        const form = screen.getByRole('form');
        expect(form).toHaveClass(formPageStyles.form);
        expect(form).not.toHaveClass(formPageStyles.cardlessForm);
    });

    it('pins the shared card to 600px and the centred form column width', () => {
        const styles = readFileSync('packages/core/src/ui/FormPage.module.css', 'utf8');
        const breakpoint = styles.indexOf('@media (min-width: 600px)');
        const narrowFormRule = styles.slice(0, breakpoint).match(/\.form\s*\{([^}]*)\}/)?.[1] || '';
        const wideFormRule = styles.slice(breakpoint).match(/\.form\s*\{([^}]*)\}/)?.[1] || '';

        expect(breakpoint).toBeGreaterThan(0);
        expect(narrowFormRule).toContain('padding: 0;');
        expect(narrowFormRule).not.toContain('background: var(--xc-card-bg);');
        expect(wideFormRule).toContain('max-width: var(--xc-form-card-max-width);');
        expect(wideFormRule).toContain('margin: 0 auto;');
        expect(wideFormRule).toContain('background: var(--xc-card-bg);');
    });

    it('keeps the top notice inside the responsive form container', async () => {
        await reach('choose');

        const form = screen.getByRole('form', { name: 'Choose hardware wallet' });
        const notice = screen.getByRole('note');
        expect(form).toContainElement(notice);
        expect(form.firstElementChild).toHaveAttribute('data-form-status');
        expect(form.firstElementChild).toContainElement(notice);
    });

    it('keeps the step 3 toggle to its three tabs, inside the four-tab limit (G131)', async () => {
        await reach('accounts');

        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    });

    it('keeps its copy free of em-dashes and device "signer" wording', () => {
        const copy = readFileSync('packages/core/src/i18n/locales/en/hardwareConnect.js', 'utf8');
        const route = readFileSync('packages/core/src/shared/routes/PairSignerForm.jsx', 'utf8');

        const longDash = String.fromCharCode(0x2014);
        expect(copy).not.toContain(longDash);
        expect(route).not.toContain(longDash);
        const values = [...copy.matchAll(/^\s*'hardwareConnect\.[^']+':\s*'([^']*)'/gm)].map((m) => m[1]);
        expect(values.length).toBeGreaterThan(40);
        for (const value of values) {
            expect(value).not.toMatch(/\bsigner\b|offline signer|watch-only|watcher/i);
        }
    });

    it('adds no route-level pull to the shared form rhythm', () => {
        const styles = readFileSync('packages/core/src/shared/routes/PairSignerForm.module.css', 'utf8');
        const groupRule = styles.match(/(?:^|\n)\.group\s*\{([^}]*)\}/)?.[1] || '';

        expect(groupRule).toContain('margin: 0;');
        expect(groupRule).not.toContain('calc(var(--xc-space-2) - var(--xc-form-gap))');
    });

    it('keeps the Networks and Accounts toggle exactly 8px below Wallet name', () => {
        const styles = readFileSync('packages/core/src/shared/routes/PairSignerForm.module.css', 'utf8');
        const tabbedRule = styles.match(/\.tabbed\s*\{([^}]*)\}/)?.[1] || '';

        expect(tabbedRule).toContain('margin-block-start: calc(var(--xc-space-2) - var(--xc-form-gap));');
    });

    it('leaves every top notice to FormPage instead of a compensating wrapper', () => {
        const styles = readFileSync('packages/core/src/shared/routes/PairSignerForm.module.css', 'utf8');
        const route = readFileSync('packages/core/src/shared/routes/PairSignerForm.jsx', 'utf8');

        expect(styles).not.toContain('.topNotices');
        expect(route).not.toContain('styles.topNotices');
        expect(route).toMatch(/label=\{t\('hardwareConnect\.choose\.formLabel'\)\}[\s\S]*?status=\{\([\s\S]*?<StatusMessage/);
        expect(route).toMatch(/label=\{t\('hardwareConnect\.connect\.formLabel'\)\}[\s\S]*?status=\{\[/);
    });
});
