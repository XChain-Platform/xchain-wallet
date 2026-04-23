// Popup top-level state machine.
//
// State transitions:
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked            (piece 5's unlock flow)
//   unlocked     -> locked              (user-triggered lock)
//   no-wallet    -> locked              (piece ships onboarding -> unlock)
//
// The background's `session.status` meta handler is the source of truth
// on mount. Route components fire transitions via the callbacks passed
// in; they are responsible for re-querying when their flow settles.

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
