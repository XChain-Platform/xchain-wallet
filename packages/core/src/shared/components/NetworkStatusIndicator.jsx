// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { registry as registryLib } from '../../index.js';
import { useReachability } from '../hooks/useReachability.js';
import { restoreFocusAfterClose } from '../utils/focusTrap.js';
import styles from './NetworkStatusIndicator.module.css';

const chainRegistry = registryLib.defaultRegistry();

function chainLabel(chainId) {
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor?.displayName) return chainId;
    return descriptor.networkKind && descriptor.networkKind !== 'mainnet'
        ? `${descriptor.displayName} ${descriptor.networkKind}`
        : descriptor.displayName;
}

function affectedChains(overall, perChain) {
    if (!Array.isArray(perChain)) return [];
    return perChain.filter((chain) => {
        if (overall === 'offline') return chain.mode !== 'normal' && chain.mode !== 'not-configured';
        return chain.mode === 'degraded' || chain.mode === 'offline';
    });
}

function serviceSummary(chain) {
    const unavailable = Object.entries(chain?.services || {})
        .filter(([, state]) => state === 'unreachable')
        .map(([service]) => service);
    if (chain.mode === 'offline') return 'unreachable';
    if (unavailable.length === 0) return 'some services are unavailable';
    return `${unavailable.join(', ')} unavailable`;
}

/**
 * Compact network-health control for the persistent app header.
 * Hover, keyboard focus, and tap all expose the per-chain explanation.
 *
 * @param {object} props
 * @param {() => void} props.onOpenNetworkSettings
 */
export function NetworkStatusIndicator({ onOpenNetworkSettings }) {
    const { overall, perChain } = useReachability();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const closePopover = useCallback(() => {
        const popover = wrapRef.current?.querySelector('[role="dialog"]');
        setOpen(false);
        restoreFocusAfterClose(triggerRef.current, popover);
    }, []);
    const state = overall === 'degraded' || overall === 'offline' || overall === 'normal'
        ? overall
        : 'unknown';
    const affected = affectedChains(state, perChain);
    const label = state === 'normal'
        ? 'Network connected'
        : state === 'degraded'
            ? 'Network degraded'
            : state === 'offline'
                ? 'Network offline'
                : 'Checking network';
    const affectedNames = affected.map((chain) => chainLabel(chain.chainId));
    const explanation = affectedNames.length > 0
        ? `${label}: ${affectedNames.join(', ')}`
        : state === 'offline'
            ? `${label}: no selected chain is reachable`
            : label;

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (!wrapRef.current?.contains(event.target)) closePopover();
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            closePopover();
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [closePopover, open]);

    return (
        <div
            ref={wrapRef}
            className={styles.wrap}
            data-state={state}
            data-open={open ? 'true' : 'false'}
        >
            <button
                ref={triggerRef}
                type="button"
                className={styles.trigger}
                onClick={() => setOpen((value) => !value)}
                aria-label={explanation}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                title={explanation}
            >
                <span className={styles.dot} aria-hidden="true" />
            </button>
            <div className={styles.popover} role="dialog" aria-label="Network status">
                <div className={styles.title}>{label}</div>
                {state === 'normal' ? (
                    <div className={styles.detail}>All selected chains are reachable.</div>
                ) : state === 'unknown' ? (
                    <div className={styles.detail}>Checking selected chains.</div>
                ) : affected.length > 0 ? (
                    <ul className={styles.chains}>
                        {affected.map((chain) => (
                            <li key={chain.chainId}>
                                <strong>{chainLabel(chain.chainId)}</strong>: {serviceSummary(chain)}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className={styles.detail}>No selected chain is reachable.</div>
                )}
                <button
                    type="button"
                    className={styles.settings}
                    onClick={() => { closePopover(); onOpenNetworkSettings(); }}
                >
                    Network settings
                </button>
            </div>
        </div>
    );
}
