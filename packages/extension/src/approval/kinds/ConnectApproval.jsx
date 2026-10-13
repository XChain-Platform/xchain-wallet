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
import { neutralizeControlText } from '@xchain-wallet/core/shared/utils/textHardening.js';
import { OriginIdentity } from '@xchain-wallet/core/shared/components/OriginIdentity.jsx';
import { CONNECT_SITE_WARNING } from '@xchain-wallet/core/shared/utils/securityMomentCopy.js';
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
 *   - Accounts come from the wallet, never the page: only the primary
 *     account starts ticked, and the grant is exactly what the user ticks.
 *   - Message-signing permission starts OFF. A site must show the message
 *     in a later approval before the user can remember that choice.
 *   - `canSignAction` starts empty. Action-kind permissions are gated
 *     inside the signAction flow with its own "always allow" toggle.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {any} props.payload  ConnectApprovalRequest
 * @param {() => void} props.onReject
 */
export function ConnectApproval({ id, payload, onReject }) {
    const appName = neutralizeControlText(payload?.appName || '', { maxLength: 80 });
    const hasRequestedChains = Array.isArray(payload?.requestedChains);
    const requestedChains = useMemo(
        () => (Array.isArray(payload?.requestedChains) ? payload.requestedChains : []),
        [payload],
    );
    const accountOptions = useMemo(
        () => (Array.isArray(payload?.accountOptions)
            ? payload.accountOptions.filter((a) => a && typeof a.id === 'string' && a.id)
            : []),
        [payload],
    );

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
    const offeredChains = useMemo(
        () => (hasRequestedChains
            ? supported.filter((descriptor) => requestedChains.includes(descriptor.id))
            : supported),
        [hasRequestedChains, requestedChains, supported],
    );

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
    const [approvedAccounts, setApprovedAccounts] = useState(
        /** @type {() => string[]} */ (() => (accountOptions[0] ? [accountOptions[0].id] : [])),
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    function toggleChain(chainId) {
        setApprovedChains((prev) =>
            prev.includes(chainId)
                ? prev.filter((c) => c !== chainId)
                : [...prev, chainId],
        );
    }

    function toggleAccount(accountId) {
        setApprovedAccounts((prev) =>
            prev.includes(accountId)
                ? prev.filter((a) => a !== accountId)
                : [...prev, accountId],
        );
    }

    // With options on screen the user must share at least one account; with
    // none (the account read failed) the background grants the primary one.
    const accountsMissing = accountOptions.length > 0 && approvedAccounts.length === 0;

    async function handleApprove() {
        if (busy || approvedChains.length === 0 || accountsMissing) return;
        setBusy(true);
        setError(null);
        try {
            await resolveApproval(id, {
                approved: true,
                chains: approvedChains,
                accounts: approvedAccounts,
                canSignMessage: false,
                canSignAction: {},
            });
            // Broker closes the window on resolve; call window.close as a
            // belt-and-braces in case the browser doesn't honour remove().
            window.close();
        } catch (err) {
            setError(err?.message || 'Could not connect this site.');
            setBusy(false);
        }
    }

    return (
        <Screen
            variant="small"
            header={
                <div className={shared.header}>
                    <span className={shared.title}>Connect to XChain Wallet?</span>
                </div>
            }
            footer={
                <div className={shared.footer}>
                    <Button variant="danger" block onClick={onReject} disabled={busy}>
                        Reject
                    </Button>
                    <Button
                        variant="primary"
                        block
                        onClick={handleApprove}
                        loading={busy}
                        disabled={approvedChains.length === 0 || accountsMissing}
                    >
                        Connect
                    </Button>
                </div>
            }
        >
            <OriginIdentity origin={payload?.origin || ''} label="Requesting site">
                {appName ? (
                    <>
                        <p className={styles.declaredNameLabel}>The site calls itself</p>
                        <p className={styles.declaredName}>{appName}</p>
                    </>
                ) : null}
            </OriginIdentity>
            <p className={styles.lede}>
                {CONNECT_SITE_WARNING}
            </p>

            <section className={styles.permissions} aria-label="Requested permissions">
                <p className={styles.permissionsTitle}>Requested permissions</p>
                <ul className={styles.permissionsList}>
                    <li>View the accounts you select, including their addresses and balances</li>
                    <li>Use only the chains you select below</li>
                    <li>Ask separately before signing any message or transaction</li>
                </ul>
            </section>

            <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Chains</legend>
                <p className={styles.hint}>
                    {hasRequestedChains
                        ? 'Choose from the chains this site requested. You can change this later.'
                        : 'Pick which chains this site can see. You can change this later.'}
                </p>
                <ul className={styles.chainList}>
                    {offeredChains.map((d) => {
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

            <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Accounts</legend>
                {accountOptions.length > 0 ? (
                    <>
                        <p className={styles.hint}>
                            Pick which accounts this site can see.
                        </p>
                        <ul className={styles.chainList}>
                            {accountOptions.map((a) => {
                                const name = neutralizeControlText(a.name || a.id, { maxLength: 80 });
                                return (
                                    <li key={a.id} className={styles.chainRow}>
                                        <label className={styles.chainLabel}>
                                            <input
                                                type="checkbox"
                                                checked={approvedAccounts.includes(a.id)}
                                                onChange={() => toggleAccount(a.id)}
                                                aria-label={`Share ${name}`}
                                            />
                                            <span>{name}</span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                ) : (
                    <p className={styles.hint}>
                        This site can see your primary account.
                    </p>
                )}
            </fieldset>

            {error ? <div className={shared.error} role="alert">{error}</div> : null}
        </Screen>
    );
}
