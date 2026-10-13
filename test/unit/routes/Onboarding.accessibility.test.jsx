// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: () => PHRASE },
    };
});

function acceptLicense() {
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
}

function draw(children, messaging = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {children}
        </MessagingProvider>,
    );
}

async function scan(container) {
    await expectNoSeriousAxeViolations(container);
}

beforeEach(() => {
    localStorage.clear();
    globalThis.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
});

afterEach(() => {
    localStorage.clear();
    delete globalThis.matchMedia;
});

describe('Onboarding accessibility', () => {
    it('has no serious violations in the license, explainer, and wallet choice steps', async () => {
        const view = draw(
            <Onboarding
                onCreate={() => {}}
                onImport={() => {}}
                onImportFromFreeWallet={() => {}}
                onPairPartner={() => {}}
            />,
        );

        await screen.findByLabelText('License terms');
        await scan(view.container);
        view.unmount();

        acceptLicense();
        const explainer = draw(
            <Onboarding
                onCreate={() => {}}
                onImport={() => {}}
                onImportFromFreeWallet={() => {}}
                onPairPartner={() => {}}
            />,
        );

        for (const title of [
            'You hold the keys',
            'Your recovery phrase is everything',
            'Sending is final',
            'One wallet, several chains',
        ]) {
            await screen.findByText(title);
            await scan(explainer.container);
            const next = screen.queryByRole('button', { name: 'Next' });
            if (next) fireEvent.click(next);
        }

        fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
        await screen.findByRole('button', { name: 'Create new wallet' });
        await scan(explainer.container);
    });

    it('has no serious violations in every create-wallet step and the confirm grid', async () => {
        let finishCreate;
        const importMnemonic = vi.fn(() => new Promise((resolve) => {
            finishCreate = resolve;
        }));
        const view = draw(
            <CreateWallet onBack={() => {}} onCreated={() => {}} />,
            { importMnemonic },
        );

        await screen.findByRole('heading', { name: 'Create a new wallet' });
        await scan(view.container);

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        await screen.findByRole('heading', { name: 'Write down your recovery phrase' });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
        await screen.findByRole('list', { name: 'Recovery phrase' });
        await scan(view.container);

        fireEvent.click(screen.getByRole('checkbox', { name: /written down my recovery phrase/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));

        const answers = await screen.findAllByLabelText(/^Word \d+$/);
        await scan(view.container);
        const words = PHRASE.split(' ');
        for (const input of answers) {
            const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
            fireEvent.change(input, { target: { value: words[position - 1] } });
        }
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));

        await screen.findByRole('heading', { name: 'Creating your wallet' });
        await scan(view.container);
        await waitFor(() => {
            if (!finishCreate) throw new Error('Wallet creation has not started.');
        });
        finishCreate({ walletId: 'wallet-1' });

        await screen.findByRole('heading', { name: 'Automatic Donation System' });
        await scan(view.container);
    });

    it('has no serious violations in each import variant', async () => {
        const mnemonic = draw(
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />,
        );
        await screen.findByRole('heading', { name: 'Import an existing wallet' });
        await scan(mnemonic.container);

        fireEvent.click(screen.getByRole('checkbox', { name: /uses a BIP39 passphrase/i }));
        await screen.findByLabelText('BIP39 passphrase');
        await scan(mnemonic.container);

        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
        await screen.findByRole('heading', { name: 'Restore from encrypted backup' });
        await scan(mnemonic.container);
        mnemonic.unmount();

        const freeWallet = draw(
            <ImportWallet
                onBack={() => {}}
                onImported={() => {}}
                mode="fresh"
                variant="freewallet"
            />,
        );
        await screen.findByRole('heading', { name: 'Import from FreeWallet' });
        await scan(freeWallet.container);
    });

    it('has no serious violations in the import completion step', async () => {
        const importMnemonic = vi.fn().mockResolvedValue({});
        const view = draw(
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />,
            { importMnemonic },
        );

        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await screen.findByRole('heading', { name: 'Automatic Donation System' });
        await scan(view.container);
    });
});
