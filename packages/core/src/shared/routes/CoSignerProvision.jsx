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
    AddressField,
    Input,
    NetworkField,
    CopyButton,
    AddressText,
    FormPage,
    StatusMessage,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    CoSignerPolicyEditor,
    emptyPolicyDraft,
    buildPolicyDraft,
    declarePolicyTokenIds,
} from './CoSignerPolicyEditor.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import {
    allowedTokensText,
    confirmationThresholdSummary,
    perActionLimitSummary,
    policyNoLimitText,
    rollingLimitSummary,
} from '../utils/coSignerPolicyLimit.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/coSigner.js';
import styles from './IssueTokenForm.module.css';
// The token page's details card: label-left value-right fact rows.
import tokenPageStyles from './ManageToken.module.css';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';

// One fact as a label-left value-right row of the details card.
function FactRow({ label, value, mono = false, testId }) {
    return (
        <div className={tokenPageStyles.approvedDetailRow}>
            <dt>{label}</dt>
            <dd className={mono ? tokenPageStyles.approvedMono : undefined} data-testid={testId}>{value}</dd>
        </div>
    );
}

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

// A policy field left unset is unrestricted; the review says so in words.
function limitValue(value) {
    return policyNoLimitText(value) ?? <code>{exactValue(value)}</code>;
}

function policyLimitValue(value, summary) {
    const noLimit = policyNoLimitText(value);
    if (noLimit) return noLimit;
    return <>{summary.join('; ')}{' '}<code>{exactValue(value)}</code></>;
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
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [agentPubkey, setAgentPubkey] = useState('');
    const [name, setName] = useState('Agent account');
    const [policyDraft, setPolicyDraft] = useState(emptyPolicyDraft());

    const [stage, setStage] = useState(/** @type {'compose' | 'review' | 'submitting' | 'done'} */ ('compose'));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [reviewPayload, setReviewPayload] = useState(/** @type {any | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const requestRef = useRef(0);
    const submittingRef = useRef(false);
    // True while Review looks up the token numbers, so a second press waits.
    const reviewingRef = useRef(false);
    // Per-ticker messages from the last token number lookup.
    const [tokenErrors, setTokenErrors] = useState(/** @type {Record<string, string> | null} */ (null));

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

    // The picked daemon address belongs to one chain, so picking another
    // network clears it. This is done in the handler rather than in an effect
    // on chainId: an effect runs after the first render with a chain, and a
    // selection made before that effect flushed was silently wiped.
    function handleChainChange(next) {
        setChainId(next);
        setDaemonAddressId('');
    }

    const chainAddresses = (chainId && addressesByChain?.[chainId]) || [];
    const daemonAddress = chainAddresses.find((a) => a.id === daemonAddressId) || null;
    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    // Compared without the parity byte: 02K and 03K are one key and its negation,
    // and whoever holds the private key for one holds it for the other.
    const walletKeyXOnly = useMemo(() => {
        const keys = new Set();
        for (const list of Object.values(addressesByChain || {})) {
            for (const a of Array.isArray(list) ? list : []) {
                const key = String(a?.publicKey || '').toLowerCase();
                if (PUBKEY_RE.test(key)) keys.add(key.slice(2));
            }
        }
        return keys;
    }, [addressesByChain]);

    // Set by a Create press, so the compose problem then shows as an error
    // and outlines its field.
    const [attempted, setAttempted] = useState(false);
    const composeError = useMemo(() => {
        if (!chainId) return 'Pick a Bitcoin network.';
        if (!btcChainIds.includes(chainId) || !descriptor) return 'Pick a supported Bitcoin network.';
        if (!daemonAddress) return 'Pick one of your addresses to be this wallet\'s key.';
        if (!PUBKEY_RE.test(String(daemonAddress.publicKey || ''))) {
            return 'The selected address has no valid compressed public key on record.';
        }
        if (!daemonAddress.derivationPath) return 'The selected address has no derivation path on record.';
        if (!PUBKEY_RE.test(agentPubkey.trim())) {
            return 'Enter the agent public key: 66 characters starting with 02 or 03.';
        }
        if (walletKeyXOnly.has(agentPubkey.trim().toLowerCase().slice(2))) {
            return 'The agent key must differ from every key in this wallet.';
        }
        const sourceAddressError = addressValidationError(daemonAddress.address, descriptor);
        if (sourceAddressError) return `This wallet's address: ${sourceAddressError}`;
        const built = buildPolicyDraft(policyDraft);
        if (built.error) return built.error;
        const addressError = policyAddressError(built, descriptor);
        if (addressError) return addressError;
        return null;
    }, [chainId, daemonAddress, agentPubkey, policyDraft, btcChainIds, descriptor, walletKeyXOnly]);

    async function handleReview(event) {
        event?.preventDefault();
        setAttempted(true);
        if (composeError || !chainId || !daemonAddress || reviewingRef.current) return;
        const built = buildPolicyDraft(policyDraft);
        if (built.error) { setSubmitError(built.error); return; }
        const addressError = policyAddressError(built, descriptor);
        if (addressError) { setSubmitError(addressError); return; }
        // Record the token number of every ticker the rules name before review;
        // a ticker that cannot be matched stays on this screen with its field marked.
        const request = requestRef.current;
        reviewingRef.current = true;
        let declared;
        try {
            declared = await declarePolicyTokenIds({ policy: built.policy, chainId, messaging });
        } finally {
            reviewingRef.current = false;
        }
        if (requestRef.current !== request) return;
        if (declared.error) {
            setTokenErrors(declared.tokenErrors);
            setSubmitError(declared.error);
            return;
        }
        setTokenErrors(null);
        setReviewPayload({
            walletId,
            chainId,
            agentPubkey: agentPubkey.trim().toLowerCase(),
            daemonPubkey: String(daemonAddress.publicKey).toLowerCase(),
            daemonDerivationPath: daemonAddress.derivationPath,
            policy: declared.policy,
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
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review' ? () => setStage('compose') : onBack}
            backLabel={stage === 'review' ? 'Back to form' : undefined}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting' ? 'Review Agent Account' : 'New Agent Account'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    // The load error, the loading line and the created-account panel lay out
    // through FormPage like the compose and review stages, so no state draws
    // straight into Screen.
    if (loadError) {
        return wrap(
            <FormPage
                label="Create agent account"
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(
            <FormPage label="Create agent account">
                <p className={styles.hint}>Loading wallet…</p>
            </FormPage>,
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="This Wallet's Key"
                walletId={walletId}
                chainId={chainId}
                onChainChange={handleChainChange}
                onPick={(address) => {
                    setDaemonAddressId(address.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (stage === 'done') {
        const account = result;
        return wrap(
            <FormPage
                label="Agent account created"
                actions={(
                    <Button
                        variant="success"
                        icon={onDone ? <Icon.ForwardIcon /> : <Icon.CheckIcon />}
                        onClick={() => (onDone ? onDone(account?.id) : onBack())}
                    >
                        {onDone ? 'View Account' : 'Done'}
                    </Button>
                )}
            >
                <p className={styles.successTitle}>Agent account created</p>
                {/* Facts as label-left value-right rows, the address in full when it fits (G99). */}
                <section className={tokenPageStyles.approvedDetailsCard} aria-label="Agent account">
                    <dl className={tokenPageStyles.approvedDetailsList}>
                        <FactRow label="Name" value={account?.name} />
                        <FactRow label="Fund this address" value={(
                            // A row of the cell's full width (not shrink-to-content), so the
                            // fit measures the real room beside the copy icon.
                            <span style={{ display: 'flex', width: '100%', minWidth: 0, alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--xc-space-1)' }}>
                                <AddressText address={account?.aggregateAddress} fit />
                                <CopyButton value={account?.aggregateAddress || ''} label="Copy Address" />
                            </span>
                        )} />
                    </dl>
                </section>
                {/* The one note, in the warning card, never a loose paragraph. */}
                <WarningCard data-agent-created-note="">
                    <WarningLine>
                        Fund this address to give the agent a balance to operate on. The
                        agent and this wallet must both sign every spend, so each request
                        waits for your approval in this wallet; the rules refuse anything
                        outside them.
                    </WarningLine>
                </WarningCard>
            </FormPage>,
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
                    <Button type="submit" variant="primary" icon={<Icon.PlusIcon />} loading={stage === 'submitting'} disabled={stage === 'submitting'}>
                        Create Agent Account
                    </Button>
                )}
            >
                {/* Every value as a label-left value-right row; no stacked uppercase labels. */}
                <section className={tokenPageStyles.approvedDetailsCard} aria-label="Agent account values">
                    <dl className={tokenPageStyles.approvedDetailsList}>
                        <FactRow label="Account name" value={reviewPayload.name} />
                        <FactRow label="Wallet" value={reviewPayload.walletId} mono />
                        <FactRow label="This wallet's address" value={<AddressText address={daemonAddress?.address || ''} fit />} />
                        <FactRow label="This wallet's public key" value={reviewPayload.daemonPubkey} mono />
                        <FactRow label="This wallet's account path" value={reviewPayload.daemonDerivationPath} mono />
                        <FactRow label="Agent public key" value={reviewPayload.agentPubkey} mono />
                        <FactRow label="Allowed actions" value={(
                            <>
                                {reviewedPolicy.allowedActions.map(actionDisplayLabel).join(', ')}
                                {' '}<code>{exactValue(reviewedPolicy.allowedActions)}</code>
                            </>
                        )} />
                        <FactRow label={t('coSigner.policy.tokens.title')} testId="review-allowed-tokens" value={(
                            <>
                                {allowedTokensText(reviewedPolicy)}
                                {Array.isArray(reviewedPolicy.allowedTicks) ? <>{' '}<code>{exactValue(reviewedPolicy.allowedTicks)}</code></> : null}
                                {/* The token number each named token is saved with. */}
                                {reviewedPolicy.tickIds ? <>{' '}<code data-testid="review-token-numbers">{exactValue(reviewedPolicy.tickIds)}</code></> : null}
                            </>
                        )} />
                        <FactRow label="Allowed recipients" value={limitValue(reviewedPolicy.allowedDestinations)} />
                        <FactRow label="Per-action limits" value={policyLimitValue(
                            reviewedPolicy.maxPerAction,
                            perActionLimitSummary(reviewedPolicy.maxPerAction),
                        )} />
                        <FactRow label="Rolling limit" value={policyLimitValue(
                            reviewedPolicy.maxPerWindow,
                            rollingLimitSummary(reviewedPolicy.maxPerWindow),
                        )} />
                        <FactRow label="Confirmation thresholds" value={policyLimitValue(
                            reviewedPolicy.confirmAbove,
                            confirmationThresholdSummary(reviewedPolicy.confirmAbove),
                        )} />
                        <FactRow label="Allowed transaction outputs" value={<code>{exactValue(reviewPayload.allowedOutputs)}</code>} />
                    </dl>
                </section>
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
                    {attempted && composeError ? <StatusMessage variant="error">{composeError}</StatusMessage> : null}
                </>
            )}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    icon={<Icon.PlusIcon />}
                >
                    Create Agent Account
                </Button>
            )}
        >
            <NetworkField
                label="Network"
                help="The Bitcoin network for the shared 2-of-2 agent account. This wallet's key must come from an address on this network."
                value={chainId}
                onChange={handleChainChange}
                chainIds={btcChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0)}
                chainRegistry={chainRegistry}
            />

            <AddressField
                label="This wallet's key"
                icon="addresses"
                value={daemonAddress?.address || ''}
                readOnly
                onChange={() => {}}
                onIconClick={() => setSourcePickerOpen(true)}
                iconLabel="Choose this wallet's key"
                placeholder="Select address"
                error={attempted && composeError && /wallet's key|public key on record|derivation path/.test(composeError) ? composeError : undefined}
                help="An automated agent shares a 2-of-2 Bitcoin address with this wallet. This wallet signs requests that fit the policy and refuses requests outside it. Pick one of your addresses on this network; its public key becomes this wallet's half of the pair."
            />

            <Input
                label="Agent public key"
                value={agentPubkey}
                onChange={(e) => setAgentPubkey(e.target.value.trim())}
                placeholder="02abcdef…"
                error={attempted && composeError && /agent public key|agent key/i.test(composeError) ? composeError : undefined}
                help="Enter the agent's compressed public key: 66 hexadecimal characters starting with 02 or 03. The agent shows this key when you set up its wallet connection."
            />

            <Input
                label="Account name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent account"
                help="Give this agent account a local label that only you see in this wallet."
            />

            <CoSignerPolicyEditor value={policyDraft} onChange={setPolicyDraft} tokenErrors={tokenErrors} />

        </FormPage>,
    );
}
