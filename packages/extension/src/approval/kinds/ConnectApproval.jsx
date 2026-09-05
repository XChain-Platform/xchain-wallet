// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Screen, Button, ChainBadge } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useSupportedChains } from '@xchain-wallet/core/shared/hooks/useSupportedChains.js';
import { getSettings, resolveApproval } from '../messaging.js';
import shared from '../approval.module.css';
import styles from './ConnectApproval.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Connect approval (§43.3 / §43.4): grants a dApp the right to call
 * `getAccounts` / `getBalances` / etc. against the permitted chains.
 *
 * Defaults favour the user:
 *   - Chains pre-select the dApp's requested set if present; otherwise
 *     an empty selection (user must opt in to each chain).
 *   - Message-signing permission defaults to OFF. dApps that want it
 *     can still request signMessage later, which triggers a per-request
 *     approval the first time (and a per-origin "always allow" opt-in).
 *   - `canSignAction` starts empty. Action-kind permissions are gated
 *     inside the signAction flow with its own "always allow" toggle.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {any} props.payload  ConnectApprovalRequest
 * @param {() => void} props.onReject
 */
export function ConnectApproval({ id, payload, onReject }) {
    const origin = payload?.origin || '';
    const appName = payload?.appName || origin;
    const requestedChains = useMemo(
        () => (Array.isArray(payload?.requestedChains) ? payload.requestedChains : []),
        [payload],
    );
    const requestedAccounts = Array.isArray(payload?.requestedAccounts)
        ? payload.requestedAccounts
        : [];

    // §9.7 Developer Mode: user-added chains live in settings.customChains
    // and the background host seeds only ITS registry instance, so this
    // realm installs them itself, the same way SignApproval does. The boot
    // read in main.jsx races this window's own request fetch and returns
    // nothing at all against a locked vault, so the connect prompt asks
    // again on mount. Idempotent under the registry has() guard.
    useEffect(() => {
        getSettings()
            .then((s) => {
                try { registryLib.hydrateCustomChainsFromSettings(chainRegistry, s); } catch { /* bundled descriptors keep serving */ }
            })
            .catch(() => { /* locked vault or read failure; bundled descriptors keep serving */ });
    }, []);

    // Live descriptor list. Hydration lands after this component mounts, so
    // a body-level supportedChains() read offers bundled chains only for the
    // life of the window; the hook re-renders on the registry's version bump.
    const supported = useSupportedChains(chainRegistry);

    // Pre-select each requested chain the first time the registry knows it,
    // tracked per id so a chain the user unchecks stays unchecked while a
    // chain that arrives with hydration still starts ticked.
    const preSelected = useRef(/** @type {Set<string> | null} */ (null));
    if (preSelected.current === null) {
        preSelected.current = new Set(
            chainRegistry.supportedChains()
                .filter((d) => requestedChains.includes(d.id))
                .map((d) => d.id),
        );
    }

    const [approvedChains, setApprovedChains] = useState(
        /** @type {() => string[]} */ (() => Array.from(preSelected.current)),
    );
    useEffect(() => {
        const fresh = supported
            .map((d) => d.id)
            .filter((id) => requestedChains.includes(id) && !preSelected.current.has(id));
        if (fresh.length === 0) return;
        for (const id of fresh) preSelected.current.add(id);
        setApprovedChains((prev) => [...prev, ...fresh.filter((id) => !prev.includes(id))]);
    }, [supported, requestedChains]);
    const [canSignMessage, setCanSignMessage] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    function toggleChain(chainId) {
        setApprovedChains((prev) =>
            prev.includes(chainId)
                ? prev.filter((c) => c !== chainId)
                : [...prev, chainId],
        );
    }

    async function handleApprove() {
        if (busy || approvedChains.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            await resolveApproval(id, {
                approved: true,
                chains: approvedChains,
                accounts: requestedAccounts,
                canSignMessage,
                canSignAction: {},
            });
            // Broker closes the window on resolve; call window.close as a
            // belt-and-braces in case the browser doesn't honour remove().
            window.close();
        } catch (err) {
            setError(err?.message || 'Approval failed.');
            setBusy(false);
        }
    }

    return (
        <Screen
            variant="popup"
            header={
                <div className={shared.header}>
                    <span className={shared.title}>Connection request</span>
                    <span className={shared.origin}>{origin}</span>
                </div>
            }
            footer={
                <div className={shared.footer}>
                    <Button variant="ghost" block onClick={onReject} disabled={busy}>
                        Reject
                    </Button>
                    <Button
                        variant="primary"
                        block
                        onClick={handleApprove}
                        loading={busy}
                        disabled={approvedChains.length === 0}
                    >
                        Connect
                    </Button>
                </div>
            }
        >
            <p className={styles.lede}>
                <strong>{appName}</strong> wants to connect to your wallet.
            </p>

            <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Chains</legend>
                <p className={styles.hint}>
                    Pick which chains {appName} can see. You can change this later.
                </p>
                <ul className={styles.chainList}>
                    {supported.map((d) => {
                        const checked = approvedChains.includes(d.id);
                        return (
                            <li key={d.id} className={styles.chainRow}>
                                <label className={styles.chainLabel}>
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleChain(d.id)}
                                        aria-label={`Allow ${d.displayName} ${d.networkKind}`}
                                    />
                                    <ChainBadge descriptor={d} size="sm" />
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </fieldset>

            <label className={shared.toggleRow}>
                <input
                    type="checkbox"
                    checked={canSignMessage}
                    onChange={(e) => setCanSignMessage(e.target.checked)}
                />
                <span>Allow {appName} to request message signatures</span>
            </label>

            {error ? <div className={shared.error} role="alert">{error}</div> : null}
        </Screen>
    );
}
