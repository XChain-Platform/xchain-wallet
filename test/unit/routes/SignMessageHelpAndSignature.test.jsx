// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';
import { VerifySignatureForm } from '../../../packages/core/src/shared/routes/VerifySignatureForm.jsx';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', async () => {
    const ReactModule = await import('react');
    return {
        OwnAddressPickerScreen: ({ onPick }) => ReactModule.createElement('button', {
            type: 'button',
            onClick: () => onPick({ id: 'address-2', address: 'bc1qsecond', source: 'hd' }),
        }, 'Pick second address'),
    };
});

const CHAIN_ID = 'bitcoin-mainnet';
const FIRST = Object.freeze({ id: 'address-1', address: 'bc1qfirst', source: 'hd', derivationPath: "m/84'/0'/0'/0/0" });
const SECOND = Object.freeze({ id: 'address-2', address: 'bc1qsecond', source: 'hd', derivationPath: "m/84'/0'/0'/0/1" });

function messagingFor({ ready = true } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [FIRST, SECOND] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: FIRST }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready }),
        signMessageRequest: vi.fn().mockResolvedValue({ signature: 'signed-value' }),
    };
    return new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

const ROOT = resolve(process.cwd());
function read(rel) { return readFileSync(resolve(ROOT, rel), 'utf8'); }

function mountWith(element, messaging) {
    render(<MessagingProvider shell="web" messaging={messaging}>{element}</MessagingProvider>);
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Sign message help tips and signed state', () => {
    it('puts a help tip on the Address, Message, Signature and inline Password labels', async () => {
        mountWith(<SignMessageForm walletId="wallet-1" onBack={() => {}} />, messagingFor({ ready: false }));
        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(FIRST.address));
        for (const name of ['Address', 'Message', 'Signature', 'Password']) {
            expect(screen.getByRole('button', { name: `About ${name}` }), name).toBeInTheDocument();
        }
    });

    it('shows the signed text in the Message font size with a copy control, and empties on edit or address switch', async () => {
        mountWith(<SignMessageForm walletId="wallet-1" onBack={() => {}} />, messagingFor());
        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(FIRST.address));
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Proof' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign message' }));

        const box = await screen.findByRole('textbox', { name: 'Signature' });
        await waitFor(() => expect(box).toHaveTextContent('signed-value'));
        expect(screen.getByRole('button', { name: 'Copy signature' })).toBeInTheDocument();

        const signatureCss = read('packages/core/src/shared/routes/SignMessageForm.module.css');
        const inputCss = read('packages/core/src/ui/Input.module.css');
        const textRule = signatureCss.match(/\.signatureText,\s*\.signaturePlaceholder \{([^}]*)\}/)[1];
        expect(textRule).toContain('font-size: var(--xc-control-font-md, 14px);');
        expect(inputCss).toContain('--xc-control-font-size: var(--xc-control-font-md, 14px);');

        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Proof 2' } });
        expect(box).toHaveTextContent('The signature appears here after you sign.');
        expect(screen.queryByRole('button', { name: 'Copy signature' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Sign message' }));
        await waitFor(() => expect(box).toHaveTextContent('signed-value'));
        fireEvent.click(screen.getByRole('button', { name: 'Choose address' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick second address' }));
        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(SECOND.address));
        expect(screen.getByRole('textbox', { name: 'Signature' }))
            .toHaveTextContent('The signature appears here after you sign.');
    });

    it('keeps no extra wrapper margin around the Network field', () => {
        const css = read('packages/core/src/shared/routes/SignMessageForm.module.css');
        expect(css).not.toContain('.networkField');
        for (const file of ['SignMessageForm.jsx', 'VerifySignatureForm.jsx']) {
            const src = read(`packages/core/src/shared/routes/${file}`);
            expect(src, file).not.toMatch(/marginBottom: 'var\(--xc-space-3\)'/);
            expect(src, file).not.toContain('styles.networkField');
        }
    });
});

describe('Verify signature help tips', () => {
    it('puts a help tip on the Address, Message and Signature labels and a green icon verify button', async () => {
        const messaging = messagingFor();
        mountWith(<VerifySignatureForm onBack={() => {}} />, messaging);
        for (const name of ['Address', 'Message', 'Signature']) {
            expect(await screen.findByRole('button', { name: `About ${name}` }), name).toBeInTheDocument();
        }
        const button = screen.getByRole('button', { name: 'Verify signature' });
        expect(button.className).toMatch(/success/);
        expect(button.querySelector('svg')).not.toBeNull();
    });
});
