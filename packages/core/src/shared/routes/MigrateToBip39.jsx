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
import { useProtectedScreen } from '../utils/screenGuard.js';
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
import { registry as registryLib, crypto as cryptoLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';

const chainRegistry = registryLib.defaultRegistry();
const MIN_PASSWORD_LENGTH = 8;

/**
 * Migrate-to-BIP39 wizard (§40.13).
 *
 * Creates a new BIP39 wallet alongside an existing
 * counterwallet-legacy wallet, then offers a per-chain sweep step:
 * each legacy address row deep-links into the dedicated SweepForm
 * (PC-34) prefilled with the matching new-wallet destination, which
 * also runs the gated-content key gate (unlock keys must be secured
 * in the vault before the sweep; on-chain handoffs are encrypted to
 * the OLD addresses, so post-migration recovery from the new seed
 * alone is impossible).
 *
 * Stage machine: explain → create → done (with per-chain sweep links).
 *
 * @param {object} props
 * @param {string} props.legacyWalletId       source wallet (counterwallet-legacy)
 * @param {() => void} props.onBack
 * @param {(newWalletId: string) => void} [props.onMigrated]  refreshes App.jsx
 * @param {(sweep: { legacyWalletId: string, newWalletId: string, chainId: string, fromAddress: string, toAddress: string }) => void} [props.onSweepChain]
 *        Opens the SweepForm for one chain row (App wires the view + props).
 */
export function MigrateToBip39({ legacyWalletId, onBack, onMigrated, onSweepChain }) {
    //  S4: Shows the old and new phrases side by side during migration.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [stage, setStage] = useState(
        /** @type {'explain' | 'create' | 'submitting' | 'backup' | 'done'} */ ('explain'),
    );
    const [name, setName] = useState('XChain BIP39 Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [legacyAddrs, setLegacyAddrs] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [newWalletId, setNewWalletId] = useState(/** @type {string | null} */ (null));
    // The generated phrase is held only until the user confirms they wrote
    // it down, then dropped. It is the ONLY copy: the wizard tells them to
    // sweep real funds into this wallet, so it must not reach the sweep
    // stage without showing them how to restore it .
    const [mnemonic, setMnemonic] = useState(/** @type {string | null} */ (null));
    const [wroteItDown, setWroteItDown] = useState(false);
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
                (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
            );
            const next = (newAddrs?.[chainId] || []).find(
                (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
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
            // Generate here and persist through the ADD path. `wallet.create`
            // is the fresh-install handler: it builds a new vault and refuses
            // outright once one exists, so this wizard - which by definition
            // runs on a device that already holds the legacy wallet - could
            // never complete through it .
            const phrase = cryptoLib.generateBip39Mnemonic(128);
            if (typeof messaging.addImportedWallet !== 'function') {
                throw new Error('messaging.addImportedWallet is not available in this shell.');
            }
            const result = await messaging.addImportedWallet({ password, mnemonic: phrase, name });
            const id = result?.walletId || result?.id || result?.wallet?.id;
            if (!id) throw new Error('Adding the BIP39 wallet did not return a walletId.');
            setNewWalletId(id);
            setMnemonic(phrase);
            setPassword('');
            setConfirm('');
            // Show the phrase BEFORE the sweep screen: the next step tells the
            // user to move real balances into this wallet.
            setStage('backup');
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
                    addresses and the new BIP39 destinations, with a Sweep step
                    for each chain that moves that address's tokens in one
                    transaction. Your coin balances are not swept; send those
                    across yourself once the tokens have landed.
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

    // Between creation and the sweep screen: the phrase is the only way to
    // restore the wallet the user is about to move funds into, and this is
    // the only moment it exists outside the vault.
    if (stage === 'backup') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Write down your recovery phrase</h2>
                <p style={explainParagraphStyle}>
                    These 12 words are the only way to restore your new BIP39
                    wallet on another device. Write them down and keep them
                    somewhere safe. Anyone who has them can spend your funds,
                    and nobody can recover them for you.
                </p>
                {mnemonic ? <MnemonicGrid mnemonic={mnemonic} variant={isFull ? 'full' : 'small'} /> : null}
                <label className={styles.hint} style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', margin: 'var(--xc-space-3) 0' }}>
                    <input
                        type="checkbox"
                        checked={wroteItDown}
                        onChange={(e) => setWroteItDown(e.target.checked)}
                    />
                    I have written down my recovery phrase.
                </label>
                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        disabled={!wroteItDown}
                        onClick={() => { setMnemonic(null); setStage('done'); }}
                    >
                        Continue to sweep
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
                    sweep each legacy address below to its matching new-wallet
                    address. The Sweep step moves balances and ownerships in one
                    transaction, and checks gated-content unlock keys are safe
                    in the vault first. Your legacy wallet stays available as
                    long as you want.
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
                                            {row.next && onSweepChain && newWalletId ? (
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => onSweepChain({
                                                        legacyWalletId,
                                                        newWalletId,
                                                        chainId: row.chainId,
                                                        fromAddress: row.legacy,
                                                        toAddress: row.next,
                                                    })}
                                                >
                                                    Sweep this chain
                                                </Button>
                                            ) : null}
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
