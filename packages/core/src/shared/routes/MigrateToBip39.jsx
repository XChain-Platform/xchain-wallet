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
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
    Icon,
} from '@xchain-wallet/core/ui';

// Why-migrate explanation copy reads as a paragraph rather than a
// caption. Override the shared `.hint` (centred, muted) with a
// left-justified, full-contrast block so the content is comfortably
// readable.
const explainParagraphStyle = {
    textAlign: 'justify',
    color: 'var(--xc-text)',
    fontSize: 'var(--xc-text-sm)',
    lineHeight: 1.55,
    margin: '0 0 var(--xc-space-3)',
};
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const MIN_PASSWORD_LENGTH = 8;

/**
 * Migrate-to-BIP39 wizard (§40.13).
 *
 * Creates a new BIP39 wallet alongside an existing
 * counterwallet-legacy wallet, then hands the user back to the
 * balances view with the addresses they need to sweep balances
 * through the normal Send flow.
 *
 * Phase 2 scope deliberately stops short of an automated one-shot
 * sweep; that requires a dedicated SweepForm surface that doesn't
 * exist yet. The wizard instead lists each legacy address with its
 * matching new-wallet destination so the user can sweep manually
 * once the flow is complete.
 *
 * Stage machine: explain → create → done.
 *
 * @param {object} props
 * @param {string} props.legacyWalletId       source wallet (counterwallet-legacy)
 * @param {() => void} props.onBack
 * @param {(newWalletId: string) => void} [props.onMigrated]  refreshes App.jsx
 */
export function MigrateToBip39({ legacyWalletId, onBack, onMigrated }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [stage, setStage] = useState(
        /** @type {'explain' | 'create' | 'submitting' | 'done'} */ ('explain'),
    );
    const [name, setName] = useState('XChain BIP39 Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [legacyAddrs, setLegacyAddrs] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [newWalletId, setNewWalletId] = useState(/** @type {string | null} */ (null));
    const [newAddrs, setNewAddrs] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );

    // Load legacy wallet's addresses for the side-by-side preview.
    useEffect(() => {
        if (!legacyWalletId) return;
        let cancelled = false;
        messaging.getAddressesByChain(legacyWalletId)
            .then((byChain) => { if (!cancelled) setLegacyAddrs(byChain); })
            .catch(() => { /* non-fatal; stage preview falls back */ });
        return () => { cancelled = true; };
    }, [legacyWalletId, messaging]);

    // Pull new-wallet addresses after creation so we can show the
    // "sweep here" destinations on the done screen.
    useEffect(() => {
        if (!newWalletId) return;
        let cancelled = false;
        messaging.getAddressesByChain(newWalletId)
            .then((byChain) => { if (!cancelled) setNewAddrs(byChain); })
            .catch(() => { /* preview only */ });
        return () => { cancelled = true; };
    }, [newWalletId, messaging]);

    const perChainPairs = useMemo(() => {
        /** @type {Array<{ chainId: string, legacy: string | null, next: string | null }>} */
        const rows = [];
        const chains = new Set([
            ...Object.keys(legacyAddrs || {}),
            ...Object.keys(newAddrs || {}),
        ]);
        for (const chainId of chains) {
            const legacy = (legacyAddrs?.[chainId] || []).find(
                (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
            );
            const next = (newAddrs?.[chainId] || []).find(
                (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
            );
            rows.push({
                chainId,
                legacy: legacy?.address || null,
                next: next?.address || null,
            });
        }
        return rows;
    }, [legacyAddrs, newAddrs]);

    async function handleCreate(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        setStage('submitting');
        setError(null);
        try {
            const result = await messaging.createWallet({ password, name });
            const id = result?.walletId || result?.id || result?.wallet?.id;
            if (!id) throw new Error('createWallet did not return a walletId.');
            setNewWalletId(id);
            setPassword('');
            setConfirm('');
            setStage('done');
            if (onMigrated) onMigrated(id);
        } catch (err) {
            setError(err?.message || 'Failed to create BIP39 wallet.');
            setStage('create');
        }
    }

        const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'done' ? 'BIP39 wallet created' : 'Migrate to BIP39'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (stage === 'explain') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Why migrate?</h2>
                <p style={explainParagraphStyle}>
                    Your current wallet uses the Counterwallet / FreeWallet
                    12-word legacy format. BIP39 is the modern standard: it
                    interoperates with every other wallet, supports 25th-word
                    passphrases, and ships with stronger derivation.
                </p>
                <p style={explainParagraphStyle}>
                    This wizard creates a new BIP39 wallet. It does not touch
                    your legacy wallet (it stays intact as a reference). After
                    creation, you'll see a side-by-side list of your legacy
                    addresses and the new BIP39 destinations. Sweep balances
                    chain-by-chain via the normal Send flow when you're ready.
                </p>
                <p style={explainParagraphStyle}>
                    Save your new BIP39 recovery phrase somewhere safe. It is
                    the only way to restore this wallet on another device.
                </p>
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack} icon={<Icon.BackIcon />}>Not now</Button>
                    <Button variant="primary" onClick={() => setStage('create')} icon={<Icon.MigrateIcon />}>
                        Continue
                    </Button>
                </div>
            </>,
        );
    }

    if (stage === 'done') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>New BIP39 wallet ready</h2>
                <p className={styles.hint}>
                    Your legacy wallet is untouched. To complete the migration,
                    sweep balances from each legacy address below to the
                    matching new-wallet address. Use Send, or the advanced
                    Sweep action, on each chain. Your legacy
                    wallet stays available as long as you want.
                </p>
                <dl className={styles.detailsList}>
                    {perChainPairs.map((row) => {
                        const d = chainRegistry.get(row.chainId);
                        return (
                            <div key={row.chainId}>
                                <dt className={styles.detailsLabel}>
                                    {d ? <ChainBadge descriptor={d} size="sm" /> : row.chainId}
                                </dt>
                                <dd className={styles.detailsValue}>
                                    {row.legacy ? (
                                        <>
                                            <div>
                                                <strong>From</strong>{' '}
                                                <AddressText address={row.legacy} />
                                            </div>
                                            <div>
                                                <strong>To</strong>{' '}
                                                {row.next
                                                    ? <AddressText address={row.next} />
                                                    : <em>generating…</em>}
                                            </div>
                                        </>
                                    ) : (
                                        <em>No legacy address on this chain.</em>
                                    )}
                                </dd>
                            </div>
                        );
                    })}
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    return wrap(
        <form onSubmit={handleCreate} noValidate>
            <Input
                label="New wallet name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                disabled={stage === 'submitting'}
            />
            <Input
                type="password"
                label="Password"
                hint={`At least ${MIN_PASSWORD_LENGTH} characters. Encrypts the new wallet on this device.`}
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                }}
                autoComplete="new-password"
                disabled={stage === 'submitting'}
            />
            <Input
                type="password"
                label="Confirm password"
                value={confirm}
                onChange={(e) => {
                    setConfirm(e.target.value);
                    if (error) setError(null);
                }}
                autoComplete="new-password"
                disabled={stage === 'submitting'}
                error={error || undefined}
            />
            <p className={styles.hint}>
                We'll generate a fresh BIP39 recovery phrase when you submit.
                Your legacy wallet password is not needed here.
            </p>
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'submitting'}
                    disabled={password.length === 0 || confirm.length === 0}
                >
                    Create BIP39 wallet
                </Button>
            </div>
        </form>,
    );
}
