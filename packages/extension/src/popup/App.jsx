// Popup top-level state machine.
//
// Primary state (from the background):
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked            (piece 5's unlock flow)
//   unlocked     -> locked              (user-triggered lock)
//   no-wallet    -> locked              (onboarding → create → unlock)
//
// Sub-route inside `unlocked` (popup-local):
//   home | receive
//
// The background's `session.status` is the source of truth for the
// primary state. Route components fire `refresh()` to re-query after
// their flow settles. The unlocked sub-route is popup-local because
// it doesn't change what the background thinks — it's just which view
// of the unlocked wallet the user is looking at.

import { useCallback, useEffect, useState } from 'react';
import { getSessionStatus, listWallets } from './messaging.js';
import { Loading } from './routes/Loading.jsx';
import { Onboarding } from './routes/Onboarding.jsx';
import { Locked } from './routes/Locked.jsx';
import { Home } from './routes/Home.jsx';
import { Receive } from './routes/Receive.jsx';

export function App() {
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'receive'} */ ('home'),
    );
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );

    const refresh = useCallback(() => {
        setStatus({ state: 'loading' });
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

    // While unlocked, keep a copy of the active walletId here so the
    // Receive view can reuse Home's single-wallet assumption without
    // re-querying `wallet.list` itself.
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
            .catch(() => { /* Home surfaces load errors on its own */ });
        return () => { cancelled = true; };
    }, [status.state]);

    switch (status.state) {
        case 'loading':
            return <Loading />;
        case 'error':
            return <Loading error={status.error} />;
        case 'no-wallet':
            return <Onboarding onCreated={refresh} />;
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
