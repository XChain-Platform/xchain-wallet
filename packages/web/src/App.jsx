// Web SPA state machine — mirrors the extension popup's App.jsx but
// reads state from the in-page host bridge rather than chrome.runtime.
//
// Primary state (from getSessionStatus):
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked  (Locked screen fires onUnlocked on success)
//   unlocked     -> locked    (Home's Lock button fires onLocked)
//   no-wallet    -> locked    (Create/Import complete; host is live; refresh())
//
// Sub-routes inside `no-wallet`:
//   welcome | create | import
// Sub-routes inside `unlocked`:
//   home | send
//
// A successful create/import leaves the host live — the next
// `getSessionStatus()` returns `unlocked` and the app transitions to
// Home without a separate unlock step.

import { useCallback, useEffect, useState } from 'react';
import { getSessionStatus, listWallets } from './messaging.js';
import { Loading } from './routes/Loading.jsx';
import { Onboarding } from './routes/Onboarding.jsx';
import { CreateWallet } from './routes/CreateWallet.jsx';
import { ImportWallet } from './routes/ImportWallet.jsx';
import { Locked } from './routes/Locked.jsx';
import { Home } from './routes/Home.jsx';
import { Send } from './routes/Send.jsx';

export function App() {
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [onboardingStep, setOnboardingStep] = useState(
        /** @type {'welcome' | 'create' | 'import'} */ ('welcome'),
    );
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'send'} */ ('home'),
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

    // Cache the active wallet id at App level so sub-routes (Send) can
    // reuse Home's single-wallet assumption without re-querying.
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
            return (
                <Home
                    onLocked={refresh}
                    onSend={activeWalletId ? () => setUnlockedView('send') : undefined}
                />
            );
        default:
            return <Loading error={`unknown state "${status.state}"`} />;
    }
}
