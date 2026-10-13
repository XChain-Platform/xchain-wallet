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
    FormPage,
    ListPage,
    Button,
    Input,
    ChainBadge,
    AddressText,
    Icon,
    StatusMessage,
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
import { registry as registryLib, crypto as cryptoLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';
import { pickQuizPositions } from '../utils/pickQuizPositions.js';
import { nextPaint } from '../utils/nextPaint.js';
import { RECOVERY_PHRASE_WARNING } from '../utils/securityMomentCopy.js';

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
 * Stage machine: explain → create → backup → verify → submitting
 * → done (with per-chain sweep links).
 *
 * @param {object} props
 * @param {string} props.legacyWalletId       source wallet (counterwallet-legacy)
 * @param {() => void} props.onBack
 * @param {(newWalletId: string) => void} [props.onMigrated]  refreshes App.jsx
 * @param {(sweep: { legacyWalletId: string, newWalletId: string, chainId: string, fromAddress: string, toAddress: string }) => void} [props.onSweepChain]
 *        Opens the SweepForm for one chain row (App wires the view + props).
 */
export function MigrateToBip39({ legacyWalletId, onBack, onMigrated, onSweepChain }) {
    // S4: Shows the new recovery phrase during migration.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [stage, setStage] = useState(
        /** @type {'explain' | 'create' | 'backup' | 'verify' | 'submitting' | 'done'} */ ('explain'),
    );
    const [name, setName] = useState('XChain BIP39 Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [legacyAddrs, setLegacyAddrs] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [legacyAddressError, setLegacyAddressError] = useState(false);
    const [newWalletId, setNewWalletId] = useState(/** @type {string | null} */ (null));
    // The phrase stays in memory until the user proves their written copy and
    // the encrypted wallet is saved. No sweep path exists before that point.
    const [mnemonic, setMnemonic] = useState(/** @type {string | null} */ (null));
    const [wroteItDown, setWroteItDown] = useState(false);
    const [quizPositions, setQuizPositions] = useState(/** @type {number[]} */ ([]));
    const [quizAnswers, setQuizAnswers] = useState(/** @type {Record<number, string>} */ ({}));
    const [quizError, setQuizError] = useState(/** @type {string | null} */ (null));
    const [newAddrs, setNewAddrs] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [newAddressError, setNewAddressError] = useState(false);
    const [addressLoadSeq, setAddressLoadSeq] = useState(0);

    // Read the legacy wallet only after the new phrase is verified and its
    // encrypted wallet is saved. Before then every exit path is side-effect free.
    useEffect(() => {
        if (!legacyWalletId || stage !== 'done') return;
        let cancelled = false;
        setLegacyAddrs(null);
        setLegacyAddressError(false);
        messaging.getAddressesByChain(legacyWalletId)
            .then((byChain) => { if (!cancelled) setLegacyAddrs(byChain); })
            .catch(() => { if (!cancelled) setLegacyAddressError(true); });
        return () => { cancelled = true; };
    }, [legacyWalletId, messaging, addressLoadSeq, stage]);

    // Pull new-wallet addresses after creation so we can show the
    // "sweep here" destinations on the done screen.
    useEffect(() => {
        if (!newWalletId) return;
        let cancelled = false;
        setNewAddrs(null);
        setNewAddressError(false);
        messaging.getAddressesByChain(newWalletId)
            .then((byChain) => { if (!cancelled) setNewAddrs(byChain); })
            .catch(() => { if (!cancelled) setNewAddressError(true); });
        return () => { cancelled = true; };
    }, [newWalletId, messaging, addressLoadSeq]);

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
    const addressLoadFailed = legacyAddressError || newAddressError;
    const addressesReady = !addressLoadFailed && legacyAddrs !== null && newAddrs !== null;

    function handleCreate(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!password || !confirm) {
            setError('Enter and confirm a password.');
            return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        setError(null);
        setMnemonic(cryptoLib.generateBip39Mnemonic(128));
        setWroteItDown(false);
        setQuizPositions([]);
        setQuizAnswers({});
        setQuizError(null);
        setStage('backup');
    }

    function handleStartVerify() {
        if (!mnemonic || !wroteItDown) return;
        const positions = pickQuizPositions(mnemonic.trim().split(/\s+/).length);
        setQuizPositions(positions);
        setQuizAnswers(Object.fromEntries(positions.map((position) => [position, ''])));
        setQuizError(null);
        setError(null);
        setStage('verify');
    }

    async function handleSubmitVerify(event) {
        event.preventDefault();
        if (!mnemonic || stage === 'submitting') return;
        const words = mnemonic.trim().split(/\s+/);
        for (const position of quizPositions) {
            const answer = (quizAnswers[position] || '').trim().toLowerCase();
            if (!answer) {
                setQuizError('Fill in every requested word.');
                return;
            }
            if (answer !== (words[position - 1] || '').toLowerCase()) {
                setQuizError(`Word ${position} does not match your recovery phrase.`);
                return;
            }
        }

        setStage('submitting');
        setError(null);
        setQuizError(null);
        await nextPaint();
        try {
            // The add path stores a second wallet in the existing vault. The
            // fresh-install create path rejects devices that already have one.
            if (typeof messaging.addImportedWallet !== 'function') {
                throw new Error('messaging.addImportedWallet is not available in this shell.');
            }
            const result = await messaging.addImportedWallet({ password, mnemonic, name, origin: 'created' });
            const id = result?.walletId || result?.id || result?.wallet?.id;
            if (!id) throw new Error('Adding the BIP39 wallet did not return a walletId.');
            setNewWalletId(id);
            try { flowsLib.markBackupVerified(id); } catch { /* best-effort reminder metadata */ }
            setPassword('');
            setConfirm('');
            setMnemonic(null);
            setStage('done');
        } catch (err) {
            setError(err?.message || 'Failed to create BIP39 wallet.');
            setStage('verify');
        }
    }

    function handleBackFromBackup() {
        setMnemonic(null);
        setWroteItDown(false);
        setQuizPositions([]);
        setQuizAnswers({});
        setQuizError(null);
        setError(null);
        setStage('create');
    }

    function handleDone() {
        if (newWalletId && onMigrated) onMigrated(newWalletId);
        onBack();
    }

    const header = (
        <PageHeader
            onBack={stage === 'done'
                ? handleDone
                : stage === 'backup'
                    ? handleBackFromBackup
                    : stage === 'verify'
                        ? () => setStage('backup')
                        : onBack}
            backDisabled={stage === 'submitting'}
            title={{
                explain: 'Upgrade recovery phrase',
                create: 'Set up new wallet',
                backup: 'Back up new phrase',
                verify: 'Verify new phrase',
                submitting: 'Creating new wallet',
                done: 'BIP39 wallet created',
            }[stage]}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (stage === 'explain') {
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>Why migrate?</h2>
                <p style={explainParagraphStyle}>
                    Your current wallet uses the legacy 12-word recovery format
                    from Counterwallet and FreeWallet. BIP39 is a widely
                    supported recovery-phrase standard and gives this wallet
                    separate addresses for each supported network.
                </p>
                <p style={explainParagraphStyle}>
                    This process creates a separate BIP39 wallet. It does not
                    convert, delete, or automatically move anything from your
                    legacy wallet. You will see and verify the new recovery
                    phrase before the new wallet is saved or any sweep can be
                    opened.
                </p>
                <p style={explainParagraphStyle}>
                    Afterward, you can review a sweep for each legacy address.
                    Sweeps move tokens and token ownerships, not native coin
                    balances such as BTC, LTC, or DOGE. Send native coins
                    separately, and leave enough behind to pay network fees.
                </p>
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack} icon={<Icon.BackIcon />}>Not now</Button>
                    <Button variant="primary" onClick={() => setStage('create')} icon={<Icon.MigrateIcon />}>
                        Continue
                    </Button>
                </div>
            </ListPage>,
        );
    }

    // The phrase remains visible until the user starts the word quiz. Returning
    // to setup discards it because no wallet has been persisted yet.
    if (stage === 'backup') {
        return wrap(
            <FormPage
                label="Back up new recovery phrase"
                actions={(
                    <>
                        <Button type="button" variant="secondary" onClick={handleBackFromBackup}>
                            Start over
                        </Button>
                        <Button type="button" variant="primary" disabled={!wroteItDown} onClick={handleStartVerify}>
                            Verify recovery phrase
                        </Button>
                    </>
                )}
            >
                <h2 className={styles.successTitle}>Write down your recovery phrase</h2>
                <p style={explainParagraphStyle}>
                    These 12 words are the only way to restore your new BIP39
                    wallet. Write them down on paper and store them safely.
                    {' '}{RECOVERY_PHRASE_WARNING}
                </p>
                {mnemonic ? <MnemonicGrid mnemonic={mnemonic} variant={variant === 'full' ? 'full' : 'small'} /> : null}
                <label className={styles.hint} style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', margin: 'var(--xc-space-3) 0' }}>
                    <input
                        type="checkbox"
                        checked={wroteItDown}
                        onChange={(e) => setWroteItDown(e.target.checked)}
                    />
                    I have written down the new recovery phrase and stored it safely.
                </label>
            </FormPage>,
        );
    }

    if (stage === 'verify') {
        return wrap(
            <FormPage
                label="Verify new recovery phrase"
                onSubmit={handleSubmitVerify}
                status={(
                    <>
                        {quizError ? <StatusMessage variant="error">{quizError}</StatusMessage> : null}
                        {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                    </>
                )}
                actions={(
                    <>
                        <Button type="button" variant="secondary" onClick={() => setStage('backup')}>
                            Back to phrase
                        </Button>
                        <Button type="submit" variant="primary">Create BIP39 wallet</Button>
                    </>
                )}
            >
                <h2 className={styles.successTitle}>Verify your written copy</h2>
                <p style={explainParagraphStyle}>
                    Enter the requested words from the recovery phrase you just
                    wrote down. The new wallet is created only after every word
                    matches.
                </p>
                {quizPositions.map((position) => (
                    <Input
                        key={position}
                        label={`Word ${position}`}
                        value={quizAnswers[position] || ''}
                        onChange={(event) => {
                            setQuizAnswers((previous) => ({
                                ...previous,
                                [position]: event.target.value,
                            }));
                            if (quizError) setQuizError(null);
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                ))}
            </FormPage>,
        );
    }

    if (stage === 'submitting') {
        return wrap(
            <FormPage label="Wallet creation status">
                <div role="status" aria-live="polite">
                    <h2 className={styles.successTitle}>Creating your new wallet</h2>
                    <p style={explainParagraphStyle}>
                        Encrypting the new BIP39 wallet with your password. This
                        can take a minute on some devices. Keep the app open.
                        Your legacy wallet remains unchanged.
                    </p>
                </div>
            </FormPage>,
        );
    }

    if (stage === 'done') {
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>New BIP39 wallet ready</h2>
                <p style={explainParagraphStyle}>
                    Your new phrase is verified and the new wallet is saved.
                    Your legacy wallet is unchanged, and nothing moves until
                    you review and submit a sweep. Each sweep can move token
                    balances and token ownerships, and checks that gated-content
                    unlock keys are stored safely first. Send native coin
                    balances separately.
                </p>
                {addressLoadFailed ? (
                    <StatusMessage
                        variant="error"
                        recovery={{
                            label: 'Retry',
                            onAction: () => setAddressLoadSeq((value) => value + 1),
                        }}
                    >
                        Could not load all migration addresses.
                    </StatusMessage>
                ) : null}
                {!addressLoadFailed && !addressesReady ? (
                    <StatusMessage>Loading migration addresses…</StatusMessage>
                ) : null}
                {addressesReady && perChainPairs.length === 0 ? (
                    <StatusMessage>No legacy addresses are available to sweep.</StatusMessage>
                ) : null}
                {addressesReady && perChainPairs.length > 0 ? (
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
                                                    <strong>Legacy address</strong>{' '}
                                                    <AddressText address={row.legacy} />
                                                </div>
                                                <div>
                                                    <strong>New wallet address</strong>{' '}
                                                    {row.next
                                                        ? <AddressText address={row.next} />
                                                        : <em>Unavailable</em>}
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
                                                        Review sweep
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
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={handleDone}>Finish</Button>
                </div>
            </ListPage>,
        );
    }

    return wrap(
        <FormPage
            label="Set up new BIP39 wallet"
            onSubmit={handleCreate}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                >
                    Generate recovery phrase
                </Button>
            )}
        >
            <Input
                label="New wallet name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
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
            />
            {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
            <p style={explainParagraphStyle}>
                This password encrypts only the new wallet on this device. Your
                legacy wallet password is not needed. Next, you will write down
                and verify a new recovery phrase before the wallet is created.
            </p>
        </FormPage>,
    );
}
