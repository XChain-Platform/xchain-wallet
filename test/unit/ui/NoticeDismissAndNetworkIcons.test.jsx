// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A dismissible notice has its close button last in the box, in the top end
// corner, and it dismisses; the network field and list draw each network's
// icon; the Import phrase count sits in the field's label row.

import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';
import { FormNotice } from '../../../packages/core/src/ui/FormNotice.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { NetworkField } from '../../../packages/core/src/ui/NetworkField.jsx';
import { NetworkOptionList } from '../../../packages/core/src/ui/NetworkPicker.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import * as branding from '../../../packages/core/src/branding/branding.js';

afterEach(cleanup);

const CHAINS = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];

describe('dismissible notice', () => {
    it('puts the close button after the content, pinned to the top end corner', () => {
        render(<StatusMessage variant="error" onDismiss={() => {}}>Camera access is turned off.</StatusMessage>);
        const box = screen.getByRole('alert');
        const close = within(box).getByRole('button', { name: 'Dismiss Notice' });
        expect(box.lastElementChild).toBe(close);
        const text = within(box).getByText('Camera access is turned off.');
        expect(text.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const css = readFileSync('packages/core/src/ui/StatusMessage.module.css', 'utf8');
        const rule = css.match(/\.dismiss\s*\{([^}]*)\}/)[1];
        expect(rule).toMatch(/align-self:\s*flex-start/);
        expect(rule).toMatch(/margin-inline-start:\s*auto/);
        expect(rule).toMatch(/order:\s*99/);
    });

    it('has no close button unless it is dismissible', () => {
        render(<StatusMessage variant="error">Nothing to close.</StatusMessage>);
        expect(screen.queryByRole('button', { name: 'Dismiss Notice' })).toBeNull();
    });

    it('calls onDismiss when the close button is pressed', () => {
        let calls = 0;
        render(<StatusMessage variant="error" onDismiss={() => { calls += 1; }}>Closable.</StatusMessage>);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss Notice' }));
        expect(calls).toBe(1);
    });

    it('dismisses a notice a form body raises into the page notice box', () => {
        function Host() {
            const [shown, setShown] = useState(true);
            return (
                <FormPage label="Test form" onSubmit={() => {}}>
                    {shown ? <FormNotice variant="error" onDismiss={() => setShown(false)}>Camera is off.</FormNotice> : null}
                </FormPage>
            );
        }
        render(<Host />);
        const box = screen.getByText('Camera is off.').closest('[role="alert"]');
        const close = within(box).getByRole('button', { name: 'Dismiss Notice' });
        expect(close.compareDocumentPosition(screen.getByText('Camera is off.')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
        fireEvent.click(close);
        expect(screen.queryByText('Camera is off.')).toBeNull();
    });
});

describe('network icons', () => {
    function wifRegistry() {
        const registry = defaultRegistry();
        return { get: (id) => registry.get(id) };
    }

    it.each(CHAINS)('shows the %s icon in the field', (chainId) => {
        render(
            <NetworkField
                label="Coin network"
                value={chainId}
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={wifRegistry()}
            />,
        );
        const trigger = screen.getByRole('button', { name: /^Coin network: / });
        const img = trigger.querySelector('img');
        expect(img).not.toBeNull();
        expect(img.getAttribute('src')).toBe(branding.chainIconSmallUrl(chainId));
    });

    it('falls back to the large icon and then a letter when an icon file fails', () => {
        render(
            <NetworkField label="Coin network" value="bitcoin-mainnet" onChange={() => {}} chainIds={CHAINS} chainRegistry={wifRegistry()} />,
        );
        const trigger = screen.getByRole('button', { name: /^Coin network: / });
        fireEvent.error(trigger.querySelector('img'));
        expect(trigger.querySelector('img').getAttribute('src')).toBe(branding.chainIconLargeUrl('bitcoin-mainnet'));
        fireEvent.error(trigger.querySelector('img'));
        expect(trigger.querySelector('img')).toBeNull();
        expect(trigger).toHaveTextContent('B');
    });

    it('draws each network icon in the list rows', () => {
        render(<NetworkOptionList value="bitcoin-mainnet" onSelect={() => {}} chainIds={CHAINS} chainRegistry={wifRegistry()} />);
        const rows = screen.getAllByRole('button', { name: /^Select / });
        expect(rows).toHaveLength(3);
        rows.forEach((row, index) => {
            const img = row.querySelector('img');
            expect(img).not.toBeNull();
            expect(img.getAttribute('src')).toBe(branding.chainIconSmallUrl(CHAINS[index]));
        });
    });
});

describe('Import phrase count', () => {
    it('sits in the Recovery phrase label row, right aligned, with no line under the field', () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
            </MessagingProvider>,
        );
        const phrase = screen.getByLabelText('Recovery phrase');
        const label = document.querySelector('label[for="xc-mnemonic"]');
        const row = label.parentElement;
        const counter = document.getElementById('xc-mnemonic-counter');
        expect(row).toContainElement(counter);
        expect(counter).toHaveTextContent('0 words entered');
        expect(document.getElementById('xc-mnemonic-status')).toBeNull();
        expect(phrase.getAttribute('aria-describedby')).toContain('xc-mnemonic-counter');
        const css = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
        expect(css).toMatch(/\.labelRow > \.counter\s*\{[^}]*margin-inline-start:\s*auto/);
    });
});
