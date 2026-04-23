// Desktop renderer App — same shape as packages/extension/src/popup/App.jsx
// and packages/web/src/App.jsx, wired against desktop-specific
// messaging + HW factories.
//
// §9.3.2: the renderer is a view only. Every state-affecting operation
// flows through `messaging.*` → preload `sendMessage` → main
// MessageHost. No keys live here.
//
// HW pairing factories (Trezor / Ledger) are not yet wired on desktop
// — those need the native node-HID / node-usb transports that arrive
// with Step 18 ("Native hardware-wallet transports wired"). Until
// then PairSignerForm renders the vendor cards with the "not
// available in this context" note, which is the expected Step 16
// behaviour.

import { useCallback, useEffect, useState } from 'react';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { Loading } from '@xchain-wallet/core/shared/routes/Loading.jsx';
import { Onboarding } from '@xchain-wallet/core/shared/routes/Onboarding.jsx';
import { CreateWallet } from '@xchain-wallet/core/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '@xchain-wallet/core/shared/routes/ImportWallet.jsx';
import { Locked } from '@xchain-wallet/core/shared/routes/Locked.jsx';
import { Home } from '@xchain-wallet/core/shared/routes/Home.jsx';
import { Send } from '@xchain-wallet/core/shared/routes/Send.jsx';
import { Receive } from '@xchain-wallet/core/shared/routes/Receive.jsx';
import { TokenWizard } from '@xchain-wallet/core/shared/routes/TokenWizard.jsx';
import { ActionsMenu } from '@xchain-wallet/core/shared/routes/ActionsMenu.jsx';
import { IssueTokenForm } from '@xchain-wallet/core/shared/routes/IssueTokenForm.jsx';
import { MintForm } from '@xchain-wallet/core/shared/routes/MintForm.jsx';
import { DestroyForm } from '@xchain-wallet/core/shared/routes/DestroyForm.jsx';
import { TokenAdminForm } from '@xchain-wallet/core/shared/routes/TokenAdminForm.jsx';
import { PairSignerForm } from '@xchain-wallet/core/shared/routes/PairSignerForm.jsx';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets } from './messaging.js';

export function App() {
    return (
        <MessagingProvider shell="desktop" messaging={messaging}>
            <AppInner />
        </MessagingProvider>
    );
}

function AppInner() {
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [onboardingStep, setOnboardingStep] = useState(
        /** @type {'welcome' | 'create' | 'import'} */ ('welcome'),
    );
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'send' | 'receive' | 'wizard' | 'actions' | 'issue' | 'mint' | 'destroy' | 'lock' | 'description' | 'transfer' | 'pair-signer'} */ ('home'),
    );
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );

    const refresh = useCallback(() => {
        setStatus({ state: 'loading' });
        setOnboardingStep('welcome');
        setUnlockedView('home');
        getSessionStatus()
            .then((next) => setStatus(next))
            .catch((err) =>
                setStatus({ state: 'error', error: err?.message || String(err) }),
            );
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
        if (status.state !== 'unlocked') {
            setActiveWalletId(null);
            return;
        }
        let cancelled = false;
        listWallets()
            .then((list) => {
                if (cancelled) return;
                if (Array.isArray(list) && list.length > 0) {
                    setActiveWalletId(list[0].id);
                }
            })
            .catch(() => { /* Home surfaces load errors */ });
        return () => { cancelled = true; };
    }, [status.state]);

    switch (status.state) {
        case 'loading':
            return <Loading />;
        case 'error':
            return <Loading error={status.error} />;
        case 'no-wallet':
            if (onboardingStep === 'create') {
                return (
                    <CreateWallet
                        onBack={() => setOnboardingStep('welcome')}
                        onCreated={refresh}
                    />
                );
            }
            if (onboardingStep === 'import') {
                return (
                    <ImportWallet
                        onBack={() => setOnboardingStep('welcome')}
                        onImported={refresh}
                    />
                );
            }
            return (
                <Onboarding
                    onCreate={() => setOnboardingStep('create')}
                    onImport={() => setOnboardingStep('import')}
                />
            );
        case 'locked':
            return <Locked onUnlocked={refresh} />;
        case 'unlocked':
            if (unlockedView === 'send' && activeWalletId) {
                return (
                    <Send
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'receive' && activeWalletId) {
                return (
                    <Receive
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'wizard' && activeWalletId) {
                return (
                    <TokenWizard
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'issue' && activeWalletId) {
                return (
                    <IssueTokenForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'mint' && activeWalletId) {
                return (
                    <MintForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'destroy' && activeWalletId) {
                return (
                    <DestroyForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (
                (unlockedView === 'lock'
                    || unlockedView === 'description'
                    || unlockedView === 'transfer')
                && activeWalletId
            ) {
                return (
                    <TokenAdminForm
                        walletId={activeWalletId}
                        mode={unlockedView}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'pair-signer' && activeWalletId) {
                // HW factories arrive with Step 18 (native node-HID +
                // node-USB transports for desktop). PairSignerForm
                // accepts undefined factories and shows a "not
                // available in this context" message — correct
                // behaviour for Step 16.
                return (
                    <PairSignerForm
                        walletId={activeWalletId}
                        pairTrezor={undefined}
                        pairLedger={undefined}
                        onBack={() => setUnlockedView('actions')}
                        onPaired={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'actions' && activeWalletId) {
                return (
                    <ActionsMenu
                        entries={buildActionEntries({
                            onIssue: () => setUnlockedView('issue'),
                            onMint: () => setUnlockedView('mint'),
                            onDestroy: () => setUnlockedView('destroy'),
                            onLock: () => setUnlockedView('lock'),
                            onUpdateDescription: () => setUnlockedView('description'),
                            onTransferOwnership: () => setUnlockedView('transfer'),
                            onPairSigner: () => setUnlockedView('pair-signer'),
                        })}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            return (
                <Home
                    onLocked={refresh}
                    onSend={activeWalletId ? () => setUnlockedView('send') : undefined}
                    onReceive={activeWalletId ? () => setUnlockedView('receive') : undefined}
                    onCreateToken={activeWalletId ? () => setUnlockedView('wizard') : undefined}
                    onActions={activeWalletId ? () => setUnlockedView('actions') : undefined}
                />
            );
        default:
            return <Loading error={`unknown state "${status.state}"`} />;
    }
}

function buildActionEntries({
    onIssue, onMint, onDestroy,
    onLock, onUpdateDescription, onTransferOwnership,
    onPairSigner,
}) {
    return [
        {
            id: 'issue',
            label: 'Issue token',
            description: 'Advanced ISSUE form — every field exposed (§40.2).',
            onSelect: onIssue,
        },
        {
            id: 'mint',
            label: 'Mint',
            description: 'Mint additional supply of a token you own (§40.3).',
            onSelect: onMint,
        },
        {
            id: 'destroy',
            label: 'Destroy',
            description: 'Burn part of your balance — irreversible (§40.4).',
            onSelect: onDestroy,
        },
        {
            id: 'lock',
            label: 'Lock supply',
            description: 'Freeze supply + minting for a token you own — permanent (§40.5).',
            onSelect: onLock,
        },
        {
            id: 'description',
            label: 'Update description',
            description: 'Change a token\'s on-chain description (§40.5).',
            onSelect: onUpdateDescription,
        },
        {
            id: 'transfer',
            label: 'Transfer ownership',
            description: 'Hand token ownership to another address (§40.5).',
            onSelect: onTransferOwnership,
        },
        {
            id: 'pair-signer',
            label: 'Pair hardware signer',
            description: 'Add a Trezor or Ledger to this wallet (native HW transports arrive at Step 18).',
            onSelect: onPairSigner,
        },
    ];
}
