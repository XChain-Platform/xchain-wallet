import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 ChainPicker,  Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './TokenWizard.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Token Creation Wizard — §40.1.
 *
 * Five-stage flow: template → chain → details → preview → sign.
 *
 *   template:  pick one of six templates (§40.1). Step 4 ships the
 *              Custom template as fully interactive; the other five
 *              are visible as cards but their dedicated detail forms
 *              land in Phase-2 Step 6 (piece 2d).
 *   chain:     pick the chain to create the token on. Filtered to
 *              chains the wallet already has an address on (needs a
 *              fee-paying address). Auto-picks the newest external
 *              HD address on that chain.
 *   details:   template-specific fields. Custom exposes all ISSUE v0
 *              fields (ticker, supply, max-mint, decimals, description,
 *              lock flags, transfer-ownership).
 *   preview:   plain-English summary from `decoder.decodeAction` for
 *              the composed ISSUE params.
 *   sign:      TODO — `messaging.issueToken` lands in Step 5 (piece
 *              2c). Today the sign button surfaces the "not yet
 *              wired" error through the shared submit path.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function TokenWizard({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [stage, setStage] = useState(
        /** @type {'template' | 'chain' | 'details' | 'preview' | 'sign' | 'done' | 'error'} */ ('template'),
    );
    const [template, setTemplate] = useState(
        /** @type {null | 'meme' | 'utility' | 'collectible' | 'community' | 'subtoken' | 'custom'} */ (null),
    );
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    // Details form state — some fields are only visible for certain
    // templates (see renderDetailsStage). Keeping all state here so
    // the user can flip between templates without re-typing.
    const [name, setName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [supply, setSupply] = useState('');
    const [divisible, setDivisible] = useState(false);
    const [description, setDescription] = useState('');
    const [maxMint, setMaxMint] = useState('');
    const [lockOnCreate, setLockOnCreate] = useState(false);
    const [transferTo, setTransferTo] = useState('');
    const [imageUrl, setImageUrl] = useState('');         // collectible only
    const [parentToken, setParentToken] = useState('');   // subtoken only

    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before creating a token.',
                    );
                    return;
                }
                setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Auto-pick the highest external HD address on the current chain.
    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const addrs = (addressesByChain[chainId] || []).filter(
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
    }, [chainId, addressesByChain]);

    useEffect(() => {
        if (stage === 'preview') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    // Compose ISSUE v0 params from the current form state. Dispatched
    // by template (see TEMPLATE_COMPOSERS) — each picks the subset of
    // ISSUE v0 fields its template wants. The memo key intentionally
    // includes `template` so switching templates re-composes.
    const actionParams = useMemo(
        () => composeIssueParams(template, {
            name,
            supply,
            maxMint,
            divisible,
            description,
            lockOnCreate,
            transferTo,
            imageUrl,
            parentToken,
        }),
        [template, name, supply, maxMint, divisible, description,
         lockOnCreate, transferTo, imageUrl, parentToken],
    );

    const decoded = useMemo(() => {
        if (stage !== 'preview' && stage !== 'sign') return null;
        return decoderLib.decodeAction({
            action: 'ISSUE',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    function handleDetailsSubmit(event) {
        event.preventDefault();
        if (!name.trim()) {
            setFormError('Token name is required.');
            return;
        }
        if (!/^[A-Za-z0-9]+$/.test(name)) {
            setFormError('Token name must be A–Z, 0–9.');
            return;
        }
        if (template === 'subtoken') {
            if (!parentToken.trim()) {
                setFormError('Parent tick is required for subtokens.');
                return;
            }
            if (!/^[A-Za-z0-9]+$/.test(parentToken)) {
                setFormError('Parent tick must be A–Z, 0–9.');
                return;
            }
        }
        // Collectible's supply is hard-wired to 1 by the composer —
        // no user-facing supply field.
        if (template !== 'collectible') {
            if (!supply.trim() || Number(supply) <= 0) {
                setFormError('Supply must be a positive number.');
                return;
            }
        }
        setFormError(null);
        setStage('preview');
    }

    async function handleSign(event) {
        event.preventDefault();
        if (stage === 'sign' || password.length === 0) return;
        setStage('sign');
        setSubmitError(null);
        try {
            // messaging.issueToken lands in Phase 2 Step 5 (piece 2c).
            // Until then the call surfaces the host's
            // "unknown-message-type" error cleanly so the user sees
            // why the sign step is gated.
            const res = await messaging.issueToken({
                walletId,
                password,
                chainId,
                from: fromAddress ? {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                } : null,
                params: actionParams,
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Sign failed.',
            );
            setStage('preview');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

        const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Create a token"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'template') {
        return wrap(renderTemplateStage({
            onPick: (t) => { setTemplate(t); setStage('chain'); },
        }));
    }

    if (stage === 'chain') {
        return wrap(renderChainStage({
            chainsWithAddresses,
            chainId,
            setChainId,
            descriptor,
            fromAddress,
            onBack: () => setStage('template'),
            onNext: () => setStage('details'),
        }));
    }

    if (stage === 'details') {
        return wrap(renderDetailsStage({
            template,
            name, setName,
            displayName, setDisplayName,
            supply, setSupply,
            divisible, setDivisible,
            description, setDescription,
            maxMint, setMaxMint,
            lockOnCreate, setLockOnCreate,
            transferTo, setTransferTo,
            imageUrl, setImageUrl,
            parentToken, setParentToken,
            formError,
            onBack: () => setStage('chain'),
            onSubmit: handleDetailsSubmit,
        }));
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Token created</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    // stage === 'preview' or 'sign'
    return wrap(
        <form onSubmit={handleSign} noValidate>
            <p className={styles.summary}>{decoded?.summary}</p>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Chain</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                </dd>
                {fromAddress ? (
                    <>
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={fromAddress.address} />
                        </dd>
                    </>
                ) : null}
                {(decoded?.details || []).map((d) => (
                    <DetailRow key={d.label} label={d.label} value={d.value} />
                ))}
            </dl>
            {decoded && decoded.warnings.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    {decoded.warnings.map((w, i) => (
                        <p key={i} className={styles.warning}>{w}</p>
                    ))}
                </div>
            ) : null}
            <Input
                ref={passwordRef}
                type="password"
                label="Password"
                hint="Required to sign."
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (submitError) setSubmitError(null);
                }}
                autoComplete="current-password"
                disabled={stage === 'sign'}
                error={submitError || undefined}
            />
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'sign'}
                    disabled={password.length === 0}
                >
                    Create token
                </Button>
            </div>
        </form>,
    );
}

/**
 * Compose an ISSUE v0 action-params object from the wizard's details
 * form. Dispatches by template; each composer picks the subset of
 * ISSUE fields its template wants. The shape matches what
 * `actionDecoder` and the SDK's `Actions.createAction` both consume.
 *
 * Template semantics (§40.1):
 *
 * - **meme**  — fire-and-forget: MAX_SUPPLY + MINT_SUPPLY + non-divisible
 *               + LOCK_MAX_SUPPLY + LOCK_MINT in one ISSUE transaction.
 *               (The spec describes a BATCH but the protocol's ISSUE v0
 *               composes all three atomically via `MINT_SUPPLY` +
 *               `LOCK_*` fields — simpler and one fewer signature.)
 * - **utility** — mintable, adjustable: MAX_SUPPLY + MAX_MINT, no lock
 *               flags. Description encouraged for discovery.
 * - **community** — dividend-capable + mintable: same shape as utility;
 *               dividends are a later DIVIDEND action on the TICK, not
 *               a flag on ISSUE.
 * - **collectible** — single-edition: MAX_SUPPLY=1 + MINT_SUPPLY=1 +
 *               non-divisible + LOCK_MAX_SUPPLY + LOCK_MINT. Image URL
 *               goes into DESCRIPTION (the JDOG protocol example). Full
 *               FILE + BATCH path is deferred past Phase 2 (BATCH bans
 *               FILE per protocol §BATCH; the FILE-action pipeline is
 *               its own feature).
 * - **subtoken** — TICK = "PARENT.CHILD"; supply + decimals + optional
 *               description. Parent-ownership check is runtime at the
 *               protocol layer; the wizard doesn't verify pre-flight.
 * - **custom**  — every ISSUE v0 field exposed. Superset of the other
 *               five; used for edge cases the templates don't cover.
 */
function composeIssueParams(template, form) {
    const composer = TEMPLATE_COMPOSERS[template] || TEMPLATE_COMPOSERS.custom;
    return composer(form);
}

const TEMPLATE_COMPOSERS = {
    meme(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';           // meme tokens are indivisible
        seedSupply(p, form);
        p.LOCK_MAX_SUPPLY = '1';
        p.LOCK_MINT = '1';
        maybeDescription(p, form);
        return p;
    },

    utility(form) {
        const p = baseParams(form);
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        maybeDescription(p, form);
        return p;
    },

    community(form) {
        // Dividend support is a protocol-level property of the TICK
        // (enforced via a DIVIDEND action on an owned token); the ISSUE
        // shape is the same as utility today.
        return TEMPLATE_COMPOSERS.utility(form);
    },

    collectible(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';
        p.MAX_SUPPLY = '1';
        p.MINT_SUPPLY = '1';
        p.LOCK_MAX_SUPPLY = '1';
        p.LOCK_MINT = '1';
        // The image URL lives in DESCRIPTION — decoder + indexer treat
        // it as-is; the explorer chooses to render linked URLs as <img>
        // when the DESCRIPTION looks like an image URI.
        if (form.imageUrl) p.DESCRIPTION = form.imageUrl.trim();
        else if (form.description) p.DESCRIPTION = form.description.trim();
        return p;
    },

    subtoken(form) {
        const p = baseParams(form);
        // TICK already came in uppercased; compose parent.child if both
        // are present. `parentToken` is the existing tick the user
        // owns; the wizard's Subtoken form prompts for it separately
        // and joins here.
        if (form.parentToken) {
            const parent = String(form.parentToken).trim().toUpperCase();
            const child = String(form.name).trim().toUpperCase();
            p.TICK = `${parent}.${child}`;
        }
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        maybeDescription(p, form);
        return p;
    },

    custom(form) {
        const p = baseParams(form);
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        maybeDescription(p, form);
        if (form.lockOnCreate) {
            p.LOCK_MAX_SUPPLY = '1';
            p.LOCK_MINT = '1';
        }
        if (form.transferTo) p.TRANSFER = form.transferTo.trim();
        return p;
    },
};

function baseParams(form) {
    return {
        VERSION: '0',
        TICK: (form.name || '').toUpperCase(),
    };
}

function seedSupply(p, form) {
    if (!form.supply) return;
    const supply = String(form.supply).trim();
    p.MAX_SUPPLY = supply;
    p.MINT_SUPPLY = supply;
}

function maybeDescription(p, form) {
    if (form.description) p.DESCRIPTION = form.description.trim();
}

const TEMPLATES = [
    {
        id: 'meme',
        name: 'Meme token',
        tagline: 'Fixed supply, locked, non-divisible — launch and forget.',
        interactive: true,
    },
    {
        id: 'utility',
        name: 'Utility token',
        tagline: 'Mintable, adjustable supply, descriptive.',
        interactive: true,
    },
    {
        id: 'collectible',
        name: 'Collectible',
        tagline: 'Single-edition NFT via FILE action.',
        interactive: true,
    },
    {
        id: 'community',
        name: 'Community',
        tagline: 'Dividend-enabled, mintable.',
        interactive: true,
    },
    {
        id: 'subtoken',
        name: 'Subtoken',
        tagline: 'Named sub-token under an tick you own.',
        interactive: true,
    },
    {
        id: 'custom',
        name: 'Custom',
        tagline: 'All ISSUE fields exposed.',
        interactive: true,
    },
];

function renderTemplateStage({ onPick }) {
    return (
        <>
            <p className={styles.stageHint}>Choose a template.</p>
            <ul className={styles.templateGrid}>
                {TEMPLATES.map((t) => (
                    <li key={t.id}>
                        <button
                            type="button"
                            className={
                                t.interactive
                                    ? styles.templateCard
                                    : `${styles.templateCard} ${styles.templateCardDisabled}`
                            }
                            onClick={() => t.interactive && onPick(t.id)}
                            disabled={!t.interactive}
                            aria-disabled={!t.interactive}
                            title={t.interactive ? undefined : 'Dedicated form ships in Phase 2 Step 6. Use Custom today.'}
                        >
                            <span className={styles.templateName}>{t.name}</span>
                            <span className={styles.templateTag}>{t.tagline}</span>
                            {!t.interactive ? (
                                <span className={styles.templateSoon}>Use Custom — dedicated form ships in Step 6</span>
                            ) : null}
                        </button>
                    </li>
                ))}
            </ul>
        </>
    );
}

function renderChainStage({
    chainsWithAddresses, chainId, setChainId, descriptor, fromAddress,
    onBack, onNext,
}) {
    return (
        <>
            <p className={styles.stageHint}>Which chain should this token live on?</p>
            {chainsWithAddresses.length > 1 ? (
                <ChainPicker label="Chain" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses} chainRegistry={chainRegistry} />
            ) : descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Fee paid by</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="primary"
                    onClick={onNext}
                    disabled={!fromAddress}
                >
                    Next
                </Button>
            </div>
        </>
    );
}

/**
 * Which ISSUE-form fields each template wants the user to fill in.
 * Fields not listed are either fixed by the composer (Meme's
 * DECIMALS=0, Collectible's MAX_SUPPLY=1) or irrelevant for the
 * template's use case. Custom exposes every field.
 */
const TEMPLATE_FIELDS = {
    meme: {
        name: true, displayName: true, supply: true, description: true,
    },
    utility: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true,
    },
    community: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true,
    },
    collectible: {
        name: true, displayName: true, imageUrl: true,
    },
    subtoken: {
        parentToken: true, name: true, displayName: true, supply: true,
        divisible: true, description: true,
    },
    custom: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true, lockOnCreate: true, transferTo: true,
    },
};

function renderDetailsStage({
    template,
    name, setName,
    displayName, setDisplayName,
    supply, setSupply,
    divisible, setDivisible,
    description, setDescription,
    maxMint, setMaxMint,
    lockOnCreate, setLockOnCreate,
    transferTo, setTransferTo,
    imageUrl, setImageUrl,
    parentToken, setParentToken,
    formError, onBack, onSubmit,
}) {
    const show = TEMPLATE_FIELDS[template] || TEMPLATE_FIELDS.custom;
    return (
        <form onSubmit={onSubmit} noValidate>
            <p className={styles.stageHint}>
                Template: <strong>{template}</strong>
            </p>
            {show.parentToken ? (
                <Input
                    label="Parent tick"
                    hint="An existing token you own. The subtoken's full ticker will be PARENT.CHILD."
                    value={parentToken}
                    onChange={(e) => setParentToken(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
            {show.name ? (
                <Input
                    label={template === 'subtoken' ? 'Subtoken name' : 'Token name (ticker)'}
                    hint="A–Z, 0–9. Uppercase."
                    value={name}
                    onChange={(e) => setName(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
            {show.displayName ? (
                <Input
                    label="Display name (optional)"
                    hint="UI label — not stored on-chain."
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.supply ? (
                <Input
                    label="Supply"
                    inputMode="decimal"
                    value={supply}
                    onChange={(e) => setSupply(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.divisible ? (
                <label className={styles.checkRow}>
                    <input
                        type="checkbox"
                        checked={divisible}
                        onChange={(e) => setDivisible(e.target.checked)}
                    />
                    <span>Divisible (8 decimal places)</span>
                </label>
            ) : null}
            {show.description ? (
                <Input
                    label="Description (optional)"
                    hint="Up to 250 characters. Stored on-chain."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    autoComplete="off"
                    maxLength={250}
                />
            ) : null}
            {show.imageUrl ? (
                <Input
                    label="Image URL"
                    hint="The collectible's image — stored in DESCRIPTION. Use a stable URL (IPFS, your own host)."
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    maxLength={250}
                />
            ) : null}
            {show.maxMint ? (
                <Input
                    label="Max mint per transaction (optional)"
                    hint="Caps how much can be minted in one MINT action."
                    inputMode="decimal"
                    value={maxMint}
                    onChange={(e) => setMaxMint(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.lockOnCreate ? (
                <label className={styles.checkRow}>
                    <input
                        type="checkbox"
                        checked={lockOnCreate}
                        onChange={(e) => setLockOnCreate(e.target.checked)}
                    />
                    <span>Lock supply + minting immediately (irreversible)</span>
                </label>
            ) : null}
            {show.transferTo ? (
                <Input
                    label="Transfer ownership to (optional)"
                    hint="Leave blank to keep control."
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                />
            ) : null}
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button type="submit" variant="primary">Preview</Button>
            </div>
        </form>
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
