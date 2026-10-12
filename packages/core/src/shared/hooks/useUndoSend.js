// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createUndoSendController } from '../../flows/undoSend.js';

// React binding of the undo-send countdown: turns controller ticks into
// `status` and `remaining` state. Callbacks are read through refs so a
// rerender with new functions never restarts a running countdown.
export function useUndoSend({ onElapsed, onCancelHold, now, setTick, clearTick } = {}) {
    const [status, setStatus] = useState('idle');
    const [remaining, setRemaining] = useState(0);

    const controllerRef = useRef(null);
    const mountedRef = useRef(true);
    const onElapsedRef = useRef(onElapsed);
    const onCancelHoldRef = useRef(onCancelHold);
    const clockRef = useRef({ now, setTick, clearTick });

    onElapsedRef.current = onElapsed;
    onCancelHoldRef.current = onCancelHold;
    clockRef.current = { now, setTick, clearTick };

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // clears the tick; the mounted guard keeps both callbacks silent
            controllerRef.current?.cancel();
        };
    }, []);

    const start = useCallback((seconds) => {
        const current = controllerRef.current;
        if (current && current.state() === 'counting') {
            // the controller owns the error for a second start
            current.start(seconds);
            return;
        }

        const clock = clockRef.current;
        const options = {
            onTick: (value) => {
                if (mountedRef.current) setRemaining(value);
            },
            onElapsed: () => {
                if (!mountedRef.current) return;
                setStatus('elapsed');
                if (onElapsedRef.current) onElapsedRef.current();
            },
            onCancel: () => {
                if (!mountedRef.current) return;
                setStatus('cancelled');
                if (onCancelHoldRef.current) onCancelHoldRef.current();
            },
        };
        if (clock.now !== undefined) options.now = clock.now;
        if (clock.setTick !== undefined) options.setTick = clock.setTick;
        if (clock.clearTick !== undefined) options.clearTick = clock.clearTick;

        const controller = createUndoSendController(options);
        controllerRef.current = controller;
        controller.start(seconds);
        setStatus(controller.state());
    }, []);

    const cancel = useCallback(() => {
        const controller = controllerRef.current;
        return controller ? controller.cancel() : false;
    }, []);

    return { status, remaining, start, cancel };
}
