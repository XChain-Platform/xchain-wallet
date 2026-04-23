// Web SPA state machine — mirrors the extension popup's App.jsx but
// reads state from the in-page host bridge rather than chrome.runtime.
//
// State transitions:
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked  (Locked screen fires onUnlocked on success)
//   unlocked     -> locked    (Home's Lock button fires onLocked)
//   no-wallet    -> locked    (onboarding flow plants a wallet in IDB —
//                              lands in piece 12)

import { useCallback, useEffect, useState } from 'react';
import { getSessionStatus } from './messaging.js';
import { Loading } from './routes/Loading.jsx';
import { Onboarding } from './routes/Onboarding.jsx';
import { Locked } from './routes/Locked.jsx';
import { Home } from './routes/Home.jsx';

export function App() {
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));

    const refresh = useCallback(() => {
        setStatus({ state: 'loading' });
        getSessionStatus()
            .then((next) => setStatus(next))
            .catch((err) =>
                setStatus({ state: 'error', error: err?.message || String(err) }),
            );
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

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
            return <Home onLocked={refresh} />;
        default:
            return <Loading error={`unknown state "${status.state}"`} />;
    }
}
