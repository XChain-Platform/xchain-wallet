// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerProvision (§22, P4 passive co-signer, management UI).
//
// Bespoke wizard to create an agent account: the wallet becomes the automated
// policy co-signer (daemon half) of a 2-of-2 MuSig2 account. The user picks a
// BTC network + one of their own addresses to be the daemon key, pastes the
// agent's public key, names the account, and authors the spending policy. On
// submit, provisionCoSignerAccount derives the aggregate P2TR address through
// the SDK and persists a CoSignerAccount; the wizard then shows the address
// to fund.
//
// No unlock is needed here: both pubkeys are public. The daemon private key is
// only derived transiently at co-sign time (see passiveCoSignForAccount).
//
// MuSig2 is BTC-only at launch (§22 + §10.3), matching the multisig routes.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    Select,
    ChainBadge,
    ChainPicker,
    CopyButton,
    AddressText,
    FormPage,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    CoSignerPolicyEditor,
    emptyPolicyDraft,
    buildPolicyDraft,
} from './CoSignerPolicyEditor.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// MuSig2 agent accounts are BTC-only at launch, mirroring MultisigCreate.
const COSIGNER_COIN = 'bitcoin';

// A compressed secp256k1 pubkey is 33 bytes = 66 hex chars.
const PUBKEY_RE = /^(02|03)[0-9a-fA-F]{64}$/;

function policyAddressError(built, descriptor) {
    for (const [index, address] of (built.policy.allowedDestinations || []).entries()) {
        const error = addressValidationError(address, descriptor);
        if (error) return `Allowed recipient ${index + 1}: ${error}`;
    }
    for (const [index, output] of built.allowedOutputs.entries()) {
        const error = addressValidationError(output.address, descriptor);
        if (error) return `Allowed output ${index + 1}: ${error}`;
    }
    return null;
}

function exactValue(value) {
    return JSON.stringify(value);
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {(accountId: string) => void} [props.onDone]   navigate to detail after create
 */
export function CoSignerProvision({ walletId, onBack, onDone }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const btcChainIds = useMemo(() => chainRegistry.byCoin(COSIGNER_COIN).map((d) => d.id), []);
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));

    const [daemonAddressId, setDaemonAddressId] = useState('');
    const [agentPubkey, setAgentPubkey] = useState('');
    const [name, setName] = useState('Agent account');
    const [policyDraft, setPolicyDraft] = useState(emptyPolicyDraft());

    const [stage, setStage] = useState(/** @type {'compose' | 'review' | 'submitting' | 'done'} */ ('compose'));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [reviewPayload, setReviewPayload] = useState(/** @type {any | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const requestRef = useRef(0);
    const submittingRef = useRef(false);

    useEffect(() => {
        const request = requestRef.current + 1;
        requestRef.current = request;
        submittingRef.current = false;
        let cancelled = false;
        setAddressesByChain(null);
        setLoadError(null);
        setChainId(null);
        setDaemonAddressId('');
        setAgentPubkey('');
        setName('Agent account');
        setPolicyDraft(emptyPolicyDraft());
        setStage('compose');
        setSubmitError(null);
        setReviewPayload(null);
        setResult(null);
        Promise.resolve()
            .then(() => messaging.getAddressesByChain(walletId))
            .then((byChain) => {
                if (cancelled || requestRef.current !== request) return;
                setAddressesByChain(byChain || {});
                const btcWithAddresses = btcChainIds.find(
                    (cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0,
                );
                if (!btcWithAddresses) {
                    setLoadError(
                        'Agent accounts are Bitcoin-only at launch. Use Receive on a BTC network to generate an address first.',
                    );
                    return;
                }
                setChainId(btcWithAddresses);
            })
            .catch((err) => {
                if (!cancelled && requestRef.current === request) {
                    setLoadError(userFacingMessage(err, 'Failed to load your addresses.'));
                }
            });
        return () => {
            cancelled = true;
            if (requestRef.current === request) {
                requestRef.current += 1;
                submittingRef.current = false;
            }
        };
    }, [walletId, btcChainIds, messaging]);

    // Reset the picked daemon address when the chain changes (the address
    // belongs to a specific chain).
    useEffect(() => { setDaemonAddressId(''); }, [chainId]);

    const chainAddresses = (chainId && addressesByChain?.[chainId]) || [];
    const daemonAddress = chainAddresses.find((a) => a.id === daemonAddressId) || null;
    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    const composeError = useMemo(() => {
        if (!chainId) return 'Pick a Bitcoin network.';
        if (!btcChainIds.includes(chainId) || !descriptor) return 'Pick a supported Bitcoin network.';
        if (!daemonAddress) return 'Pick one of your addresses to be this wallet\'s key.';
        if (!PUBKEY_RE.test(String(daemonAddress.publicKey || ''))) {
            return 'The selected address has no valid compressed public key on record.';
        }
        if (!daemonAddress.derivationPath) return 'The selected address has no derivation path on record.';
        if (!PUBKEY_RE.test(agentPubkey.trim())) {
            return 'Enter a compressed agent public key starting with 02 or 03, followed by 64 hex characters.';
        }
        if (agentPubkey.trim().toLowerCase() === String(daemonAddress.publicKey).toLowerCase()) {
            return 'The agent key must differ from this wallet\'s key.';
        }
        const sourceAddressError = addressValidationError(daemonAddress.address, descriptor);
        if (sourceAddressError) return `This wallet's address: ${sourceAddressError}`;
        const built = buildPolicyDraft(policyDraft);
        if (built.error) return built.error;
        const addressError = policyAddressError(built, descriptor);
        if (addressError) return addressError;
        return null;
    }, [chainId, daemonAddress, agentPubkey, policyDraft, btcChainIds, descriptor]);

    function handleReview(event) {
        event?.preventDefault();
        if (composeError || !chainId || !daemonAddress) return;
        const built = buildPolicyDraft(policyDraft);
        if (built.error) { setSubmitError(built.error); return; }
        const addressError = policyAddressError(built, descriptor);
        if (addressError) { setSubmitError(addressError); return; }
        setReviewPayload({
            walletId,
            chainId,
            agentPubkey: agentPubkey.trim().toLowerCase(),
            daemonPubkey: String(daemonAddress.publicKey).toLowerCase(),
            daemonDerivationPath: daemonAddress.derivationPath,
            policy: built.policy,
            allowedOutputs: built.allowedOutputs,
            name: name.trim() || 'Agent account',
        });
        setSubmitError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event?.preventDefault();
        if (!reviewPayload || submittingRef.current) return;

        const request = requestRef.current;
        const payload = reviewPayload;
        submittingRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const r = await messaging.provisionCoSignerAccount(payload);
            if (requestRef.current === request) {
                if (!r || r.walletId !== walletId || r.chainId !== payload.chainId) {
                    throw new Error('The created agent account could not be loaded for this wallet and network.');
                }
                setResult(r);
                setStage('done');
            }
        } catch (err) {
            if (requestRef.current === request) {
                setSubmitError(userFacingMessage(err, 'Failed to create the agent account.'));
                setStage('review');
            }
        } finally {
            if (requestRef.current === request) submittingRef.current = false;
        }
    }

    const header = (
        <PageHeader
            onBack={stage === 'review' ? () => setStage('compose') : onBack}
            backLabel={stage === 'review' ? 'Back to form' : undefined}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting' ? 'Review agent account' : 'New agent account'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        const account = result;
        return wrap(
            <>
                <p className={styles.successTitle}>Agent account created</p>
                <p className={styles.hint}>
                    Fund this address to give the agent a balance to operate on. The
                    agent and this wallet must both sign every spend; this wallet
                    signs automatically when a request satisfies the policy, and asks
                    you to approve each one.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Name</dt>
                    <dd className={styles.detailsValue}>{account?.name}</dd>
                    <dt className={styles.detailsLabel}>Fund this address</dt>
                    <dd className={styles.detailsValue} style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <AddressText address={account?.aggregateAddress} />
                        <CopyButton value={account?.aggregateAddress || ''} label="Copy address" />
                    </dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={() => (onDone ? onDone(account?.id) : onBack())}>
                        {onDone ? 'View account' : 'Done'}
                    </Button>
                </div>
            </>,
        );
    }

    if ((stage === 'review' || stage === 'submitting') && reviewPayload) {
        const reviewedPolicy = reviewPayload.policy;
        return wrap(
            <FormPage
                label="Review agent account"
                onSubmit={handleSubmit}
                status={submitError ? <StatusMessage variant="error">{submitError}</StatusMessage> : null}
                actions={(
                    <Button type="submit" variant="primary" loading={stage === 'submitting'} disabled={stage === 'submitting'}>
                        Create agent account
                    </Button>
                )}
            >
                <p className={styles.hint}>Check every value before creating this account.</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Account name</dt>
                    <dd className={styles.detailsValue}>{reviewPayload.name}</dd>
                    <dt className={styles.detailsLabel}>Wallet</dt>
                    <dd className={styles.detailsValue}><code>{reviewPayload.walletId}</code></dd>
                    <dt className={styles.detailsLabel}>Network</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                        {' '}<code>{reviewPayload.chainId}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>This wallet's address</dt>
                    <dd className={styles.detailsValue}><AddressText address={daemonAddress?.address || ''} /></dd>
                    <dt className={styles.detailsLabel}>This wallet's public key</dt>
                    <dd className={styles.detailsValue}><code>{reviewPayload.daemonPubkey}</code></dd>
                    <dt className={styles.detailsLabel}>This wallet's derivation path</dt>
                    <dd className={styles.detailsValue}><code>{reviewPayload.daemonDerivationPath}</code></dd>
                    <dt className={styles.detailsLabel}>Agent public key</dt>
                    <dd className={styles.detailsValue}><code>{reviewPayload.agentPubkey}</code></dd>
                    <dt className={styles.detailsLabel}>Allowed actions</dt>
                    <dd className={styles.detailsValue}>
                        {reviewedPolicy.allowedActions.map(actionDisplayLabel).join(', ')}
                        {' '}<code>{exactValue(reviewedPolicy.allowedActions)}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Allowed recipients</dt>
                    <dd className={styles.detailsValue}><code>{exactValue(reviewedPolicy.allowedDestinations)}</code></dd>
                    <dt className={styles.detailsLabel}>Per-action limits</dt>
                    <dd className={styles.detailsValue}><code>{exactValue(reviewedPolicy.maxPerAction)}</code></dd>
                    <dt className={styles.detailsLabel}>Rolling limit</dt>
                    <dd className={styles.detailsValue}><code>{exactValue(reviewedPolicy.maxPerWindow)}</code></dd>
                    <dt className={styles.detailsLabel}>Confirmation thresholds</dt>
                    <dd className={styles.detailsValue}><code>{exactValue(reviewedPolicy.confirmAbove)}</code></dd>
                    <dt className={styles.detailsLabel}>Allowed transaction outputs</dt>
                    <dd className={styles.detailsValue}><code>{exactValue(reviewPayload.allowedOutputs)}</code></dd>
                </dl>
            </FormPage>,
        );
    }

    return wrap(
        <FormPage
            label="Create agent account"
            onSubmit={handleReview}
            status={(
                <>
                    {submitError ? <StatusMessage variant="error">{submitError}</StatusMessage> : null}
                    {composeError ? <p className={styles.hint}>{composeError}</p> : null}
                </>
            )}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    disabled={Boolean(composeError)}
                >
                    Review agent account
                </Button>
            )}
        >
            <details>
                <summary>How agent accounts work</summary>
                <p className={styles.hint}>
                    An automated agent shares a 2-of-2 address with this wallet. This wallet signs requests that
                    fit the policy and refuses requests outside it. Agent accounts support Bitcoin networks.
                </p>
            </details>
            <ChainPicker
                label="Network"
                value={chainId}
                onChange={setChainId}
                chainIds={btcChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0)}
                chainRegistry={chainRegistry}
            />

            <Select
                label="This wallet's key"
                value={daemonAddressId}
                onChange={(e) => setDaemonAddressId(e.target.value)}
                hint="One of your addresses on this network. Its public key becomes this wallet's half of the pair."
            >
                <option value="">Select address</option>
                {chainAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                        {a.address}{a.label ? ` · ${a.label}` : ''}
                    </option>
                ))}
            </Select>

            <Input
                label="Agent public key (hex, 33-byte compressed)"
                value={agentPubkey}
                onChange={(e) => setAgentPubkey(e.target.value.trim())}
                placeholder="02abcdef…"
            />

            <Input
                label="Account name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent account"
            />

            <CoSignerPolicyEditor value={policyDraft} onChange={setPolicyDraft} />

        </FormPage>,
    );
}
