// Popup top-level state machine.
//
// Primary state (from the background):
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked            (piece 5's unlock flow)
//   unlocked     -> locked              (user-triggered lock)
//   no-wallet    -> locked              (onboarding → create/import → unlock)
//
// Sub-routes:
//   no-wallet   : welcome | create | import
//   unlocked    : home | receive

import { useCallback, useEffect, useState } from 'react';
import { getSessionStatus, listWallets } from './messaging.js';
import { Loading } from './routes/Loading.jsx';
import { Onboarding } from './routes/Onboarding.jsx';
import { CreateWallet } from './routes/CreateWallet.jsx';
import { ImportWallet } from './routes/ImportWallet.jsx';
import { Locked } from './routes/Locked.jsx';
import { Home } from './routes/Home.jsx';
import { Receive } from './routes/Receive.jsx';

export function App() {
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [onboardingStep, setOnboardingStep] = useState(
        /** @type {'welcome' | 'create' | 'import'} */ ('welcome'),
    );
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'receive'} */ ('home'),
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

    useEffect(() => {
        refresh();
    }, [refresh]);

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
            if (unlockedView === 'receive' && activeWalletId) {
                return (
                    <Receive
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            return (
                <Home
                    onLocked={refresh}
                    onReceive={() => setUnlockedView('receive')}
                />
            );
        default:
            return <Loading error={`unknown state "${status.state}"`} />;
    }
}
