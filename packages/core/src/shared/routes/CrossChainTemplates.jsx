// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { CROSS_CHAIN_TEMPLATES } from '../../templates/cross-chain/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

const COIN_TICKER_TO_NAME = {
    BTC: 'bitcoin',
    LTC: 'litecoin',
    DOGE: 'dogecoin',
};

/**
 * §42.8.4 Cross-chain templates list.
 *
 * Lists the bundled templates (`packages/core/src/templates/cross-
 * chain/*.json`). For each, shows name + description + per-row
 * preview + a "Use template" launch button that opens the Parallel
 * composer (§42.8.2) with rows pre-filled.
 *
 * Chain resolution. Each template row has a `chainHint`:
 *   - `primary`:   the wallet's first chain with addresses
 *   - `secondary`: the second
 *   - `tertiary`:  the third
 *
 * The template authors don't know which chains a given user has
 * addresses on; the launch step resolves each hint to a concrete
 * `chainId` before handing the row list to the composer. If a
 * template wants three chains and the wallet only has two, the
 * tertiary row falls back to the secondary chain (and the user can
 * fix it in the composer).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(prefill: Array<{ chainId: string, action: string, params: Record<string, string>, note?: string }>) => void} props.onLaunch
 * @param {() => void} props.onBack
 */
export function CrossChainTemplates({ walletId, onLaunch, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [chainsWithAddresses, setChainsWithAddresses] = useState(/** @type {string[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const chains = Object.entries(byChain || {})
                    .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                    .map(([cid]) => cid);
                setChainsWithAddresses(chains);
                if (chains.length === 0) {
                    setLoadError('No addresses yet. Use Receive to generate addresses on at least two chains before launching a cross-chain template.');
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallet.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const launchTemplate = (template) => {
        if (chainsWithAddresses.length === 0) return;
        const resolveChainId = (hint) => {
            const slot = hint === 'primary' ? 0 : hint === 'secondary' ? 1 : 2;
            return chainsWithAddresses[slot]
                || chainsWithAddresses[chainsWithAddresses.length - 1];
        };
        // For LINK rows, swap the placeholder COIN1/COIN2 to the
        // resolved chains' actual tickers when possible. Action
        // indices stay as placeholders; they're only known after
        // earlier rows broadcast and confirm.
        const prefill = template.actions.map((row) => {
            const chainId = resolveChainId(row.chainHint);
            const params = { ...row.params };
            if (row.action === 'LINK') {
                const primaryDescriptor = chainRegistry.get(resolveChainId('primary'));
                const secondaryDescriptor = chainRegistry.get(resolveChainId('secondary'));
                const primaryTicker = primaryDescriptor
                    ? coinNameToTicker(primaryDescriptor.coin)
                    : params.COIN1;
                const secondaryTicker = secondaryDescriptor
                    ? coinNameToTicker(secondaryDescriptor.coin)
                    : params.COIN2;
                if (primaryTicker) params.COIN1 = primaryTicker;
                if (secondaryTicker) params.COIN2 = secondaryTicker;
            }
            return {
                chainId,
                action: row.action,
                params,
                note: row.note,
            };
        });
        onLaunch(prefill);
    };

        const header = (
        <PageHeader
            onBack={onBack}
            title="Cross-chain templates"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {children}
            </div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );

    if (loadError) {
        return wrap(
            <StatusMessage variant="error" className={styles.entryDescription}>{loadError}</StatusMessage>,
        );
    }

    return wrap(
        CROSS_CHAIN_TEMPLATES.map((t) => (
            <article key={t.id} className={styles.entry} style={{ display: 'block' }}>
                <span className={styles.entryLabel}>{t.name}</span>
                <span className={styles.entryDescription}>{t.description}</span>
                {Array.isArray(t.personas) && t.personas.length > 0 ? (
                    <span className={styles.entryDescription} style={{ fontStyle: 'italic' }}>
                        Persona: {t.personas.join(', ')}
                    </span>
                ) : null}
                <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.85em' }}>
                    {t.actions.map((row, i) => (
                        <li key={i} style={{ marginBottom: '0.25rem' }}>
                            <strong>{actionDisplayLabel(row.action)}</strong> on{' '}
                            <em>{labelForChainHint(row.chainHint, chainsWithAddresses)}</em>
                            {row.note ? <> <span style={{ opacity: 0.8 }}>({row.note})</span></> : null}
                        </li>
                    ))}
                </ol>
                <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                        variant="primary"
                        onClick={() => launchTemplate(t)}
                        disabled={chainsWithAddresses.length === 0}
                    >
                        Use template
                    </Button>
                </div>
            </article>
        )),
    );
}

function labelForChainHint(hint, chains) {
    const slot = hint === 'primary' ? 0 : hint === 'secondary' ? 1 : 2;
    const cid = chains[slot] || chains[chains.length - 1];
    if (!cid) return hint;
    const d = chainRegistry.get(cid);
    return d?.displayName || cid;
}

function coinNameToTicker(coin) {
    for (const [ticker, name] of Object.entries(COIN_TICKER_TO_NAME)) {
        if (name === coin) return ticker;
    }
    return null;
}
