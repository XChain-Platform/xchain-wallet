// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { createWatchBridge } from '../../watch/watchBridge.js';

export function useWatchAvailable({ bridge } = {}) {
    const defaultBridge = useRef();
    if (bridge === undefined && defaultBridge.current === undefined) {
        defaultBridge.current = createWatchBridge();
    }
    const activeBridge = bridge === undefined ? defaultBridge.current : bridge;
    const [result, setResult] = useState(() => ({
        bridge: activeBridge,
        available: false,
    }));

    useEffect(() => {
        let active = true;

        Promise.resolve()
            .then(() => activeBridge.isAvailable())
            .then(
                (answer) => {
                    if (active) {
                        setResult({ bridge: activeBridge, available: answer === true });
                    }
                },
                () => {
                    if (active) {
                        setResult({ bridge: activeBridge, available: false });
                    }
                },
            );

        return () => {
            active = false;
        };
    }, [activeBridge]);

    return result.bridge === activeBridge && result.available === true;
}
