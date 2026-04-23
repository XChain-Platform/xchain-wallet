// Popup top-level state machine.
//
// Primary state (from the background):
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked
//   unlocked     -> locked
//   no-wallet    -> locked  (onboarding → create/import → unlock)
//
// Sub-routes:
//   no-wallet   : welcome | create | import
//   unlocked    : home | send | receive
//
// All routes render from @xchain-wallet/core/shared/routes/* via the
// MessagingProvider context (shell="popup"). Popup-local wiring boils
// down to session-state polling and sub-route navigation.

import { useCallback, useEffect, useState } from 'react';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { Loading } from '@xchain-wallet/core/shared/routes/Loading.jsx';
import { Onboarding } from '@xchain-wallet/core/shared/routes/Onboarding.jsx';
import { CreateWallet } from '@xchain-wallet/core/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '@xchain-wallet/core/shared/routes/ImportWallet.jsx';
import { Locked } from '@xchain-wallet/core/shared/routes/Locked.jsx';
import { Home } from '@xchain-wallet/core/shared/routes/Home.jsx';
import { Receive } from '@xchain-wallet/core/shared/routes/Receive.jsx';
import { Send } from '@xchain-wallet/core/shared/routes/Send.jsx';
import { TokenWizard } from '@xchain-wallet/core/shared/routes/TokenWizard.jsx';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets } from './messaging.js';

export function App() {
    return (
        <MessagingProvider shell="popup" messaging={messaging}>
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
        /** @type {'home' | 'send' | 'receive' | 'wizard'} */ ('home'),
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
            return (
                <Home
                    onLocked={refresh}
                    onSend={activeWalletId ? () => setUnlockedView('send') : undefined}
                    onReceive={activeWalletId ? () => setUnlockedView('receive') : undefined}
                    onCreateToken={activeWalletId ? () => setUnlockedView('wizard') : undefined}
                />
            );
        default:
            return <Loading error={`unknown state "${status.state}"`} />;
    }
}
