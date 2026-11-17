// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { UnlinkHardwareWallet } from '../../../packages/core/src/shared/components/UnlinkHardwareWallet.jsx';
import unlinkSource from '../../../packages/core/src/shared/components/UnlinkHardwareWallet.jsx?raw';

const formCss = readFileSync('packages/core/src/ui/FormPage.module.css', 'utf8');
const cardCss = readFileSync('packages/core/src/ui/Card.module.css', 'utf8');
const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
const unlinkCss = readFileSync('packages/core/src/shared/components/UnlinkHardwareWallet.module.css', 'utf8');

function rule(sheet, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(sheet)?.[1] ?? '';
}

const HW = { id: 'hw-1', name: 'My Trezor' };
const SIGNER = { id: 'sig-1', walletId: HW.id, vendor: 'trezor', model: 'Safe 3' };

afterEach(cleanup);

describe('hardware wallet manage card rule', () => {
    it('keeps the Unlink notice, device and action in the shared form frame', () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <UnlinkHardwareWallet
                    wallet={HW}
                    signer={SIGNER}
                    accountCount={3}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        const frame = screen.getByRole('group', { name: 'Unlink Wallet' });
        expect(frame).toHaveAttribute('data-unlink-hardware-wallet');
        const notice = within(frame).getByRole('note');
        expect(notice).toHaveTextContent('Your coins stay on the');
        expect(frame.querySelector('[data-form-status]')).toContainElement(notice);
        expect(frame).toContainElement(document.querySelector('[data-hardware-device-card]'));
        expect(within(frame).getByRole('button', { name: 'Unlink Wallet' })).toBeInTheDocument();
        expect(unlinkSource).toMatch(/<FormPage[\s\S]*?as="div"[\s\S]*?className=\{styles\.form\}[\s\S]*?status=\{\([\s\S]*?actions=\{\(/);
    });

    it('puts the notice 8px below the page header and 8px above the device card', () => {
        expect(tokensCss).toMatch(/--xc-space-2:\s*8px;/);
        expect(tokensCss).toMatch(/--xc-page-top:\s*var\(--xc-space-2\);/);
        expect(rule(screenCss, '.body')).toMatch(/padding:\s*var\(--xc-page-top\) var\(--xc-page-gutter\);/);
        expect(rule(unlinkCss, '[data-unlink-hardware-wallet].form'))
            .toMatch(/--xc-form-gap:\s*var\(--xc-space-2\);/);
        expect(rule(unlinkCss, '[data-unlink-hardware-wallet].form'))
            .not.toMatch(/(?:^|[;\s])gap:\s*var\(--xc-space-2\);/);
    });

    it('keeps the device card border and radius inside the wide form card', () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <UnlinkHardwareWallet
                    wallet={HW}
                    signer={SIGNER}
                    accountCount={3}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        const device = document.querySelector('[data-hardware-device-card]');
        expect(device.closest('[data-xc-preserve-nested-cards]')).not.toBeNull();
        expect(unlinkSource).toMatch(/data-xc-preserve-nested-cards[\s\S]*?<HardwareDeviceCard/);

        const baseCard = rule(cardCss, '.card');
        expect(baseCard).toMatch(/border:\s*var\(--xc-card-border\);/);
        expect(baseCard).toMatch(/border-radius:\s*var\(--xc-card-radius\);/);

        const preserved = rule(cardCss, '.formCard:not(.cardless) [data-xc-preserve-nested-cards] .card');
        expect(preserved).toMatch(/border:\s*var\(--xc-card-border\);/);
        expect(preserved).toMatch(/border-radius:\s*var\(--xc-card-radius\);/);
    });

    it('is bare below 600px and becomes a centred 560px card from 600px', () => {
        const breakpoint = formCss.indexOf('@media (min-width: 600px)');
        expect(breakpoint).toBeGreaterThan(0);

        const narrowForm = rule(formCss.slice(0, breakpoint), '.form');
        expect(narrowForm).toMatch(/width:\s*100%;/);
        expect(narrowForm).toMatch(/padding:\s*0;/);

        const wideForm = rule(formCss.slice(breakpoint), '.form');
        expect(tokensCss).toMatch(/--xc-form-card-max-width:\s*560px;/);
        expect(wideForm).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        expect(wideForm).toMatch(/margin:\s*0 auto;/);
        expect(wideForm).toMatch(/padding:\s*var\(--xc-card-pad\);/);
        expect(wideForm).toMatch(/border:\s*var\(--xc-card-border\);/);
    });
});
