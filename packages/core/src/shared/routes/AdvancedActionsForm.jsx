import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Rest-fields carry a '...' prefix in the SDK's field list (see
// xchain-sdk/src/formatSelector.js). The form splits array input on
// newlines/commas — same convention as AirdropForm's paste box.
const REST_PREFIX = '...';

// VERSION is auto-selected by the SDK's FormatSelector, never
// user-provided in the form.
const AUTO_FIELDS = new Set(['VERSION']);

// Actions that have their own dedicated forms. The Advanced form
// still exposes them (power users may want the raw field surface),
// but the dropdown decorates them with "(dedicated form available)"
// so the user doesn't reach for Advanced when a curated UX exists.
const ACTIONS_WITH_DEDICATED_FORMS = new Set([
    'SEND', 'SWEEP', 'ISSUE', 'MINT', 'DESTROY',
    'BROADCAST', 'DISPENSER', 'DIVIDEND', 'AIRDROP', 'LIST',
]);

/**
 * Advanced Actions form — §40.10.
 *
 * Generic "submit any XChain action" surface for power users and for
 * action kinds without a dedicated form (LINK, FILE beyond
 * collectibles, ADDRESS, CALLBACK, SLEEP, raw MESSAGE). Fields are
 * driven entirely by the SDK's schema introspection — the form has no
 * per-action knowledge beyond generic rendering rules for rest-fields
 * + auto-fields.
 *
 * Stage machine: compose → review → submitting → done. Live
 * validation runs on every keystroke via `messaging.validateAction`.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function AdvancedActionsForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [actions, setActions] = useState(/** @type {string[] | null} */ (null));
    const [action, setAction] = useState('');
    const [formats, setFormats] = useState(
        /** @type {Record<string, string> | null} */ (null),
    );
    const [version, setVersion] = useState('');
    const [fields, setFields] = useState(/** @type {string[]} */ ([]));
    const [values, setValues] = useState(/** @type {Record<string, string>} */ ({}));
    const [validation, setValidation] = useState(
        /** @type {{ valid: boolean, errors: any[] } | null} */ (null),
    );

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review' | 'submitting' | 'done'} */ ('compose'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [password, setPassword] = useState('');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Addresses on mount.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before authoring an action.',
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

    // Default fromAddress when chain settles.
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

    // Load the action list when chain settles.
    useEffect(() => {
        if (!chainId) return;
        let cancelled = false;
        messaging.listActions({ chainId })
            .then((list) => {
                if (!cancelled) {
                    const sorted = [...(list || [])].sort();
                    setActions(sorted);
                }
            })
            .catch((err) => {
                if (!cancelled) setFormError(err?.message || 'Failed to load actions.');
            });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    // When action changes, load its formats + fields and reset values.
    useEffect(() => {
        if (!chainId || !action) {
            setFormats(null);
            setFields([]);
            setValues({});
            setValidation(null);
            return;
        }
        let cancelled = false;
        Promise.all([
            messaging.getActionFormats({ chainId, action }),
            messaging.getActionFields({ chainId, action }),
        ])
            .then(([fmts, fls]) => {
                if (cancelled) return;
                setFormats(fmts || {});
                const filtered = (fls || []).filter((f) => !AUTO_FIELDS.has(baseFieldName(f)));
                // Deduplicate — multi-version formats repeat rest-field
                // slots across versions; we only want one input per
                // canonical name.
                const seen = new Set();
                const unique = [];
                for (const f of filtered) {
                    const key = f; // preserve '...' prefix so rest-fields render as arrays
                    if (!seen.has(key)) { seen.add(key); unique.push(f); }
                }
                setFields(unique);
                setValues({});
                setValidation(null);
            })
            .catch((err) => {
                if (!cancelled) setFormError(err?.message || 'Failed to load action fields.');
            });
        return () => { cancelled = true; };
    }, [chainId, action, messaging]);

    // Live validation — runs on every keystroke. The SDK validator is
    // in-memory only (no network), so the cost is negligible.
    useEffect(() => {
        if (!chainId || !action || fields.length === 0) {
            setValidation(null);
            return;
        }
        const populated = buildParams(fields, values, version);
        // Only validate if at least one field is filled — empty forms
        // shouldn't splash red on first load.
        const anyFilled = Object.values(populated).some(
            (v) => v !== '' && (!Array.isArray(v) || v.length > 0),
        );
        if (!anyFilled) { setValidation(null); return; }
        let cancelled = false;
        messaging.validateAction({ chainId, action, params: populated })
            .then((res) => { if (!cancelled) setValidation(res); })
            .catch(() => { /* validation is advisory — swallow network hiccups */ });
        return () => { cancelled = true; };
    }, [chainId, action, fields, values, version, messaging]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    const actionParams = useMemo(
        () => buildParams(fields, values, version),
        [fields, values, version],
    );

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action,
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, action, actionParams, chainId]);

    const handleFieldChange = useCallback((field, rawValue) => {
        setValues((prev) => ({ ...prev, [field]: rawValue }));
    }, []);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!action) {
            setFormError('Pick an action.');
            return;
        }
        if (validation && !validation.valid) {
            setFormError('Fix the validation errors below before previewing.');
            return;
        }
        setFormError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || password.length === 0) return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await messaging.advancedAction({
                walletId,
                password,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                },
                action,
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
                    : err?.message || 'Action failed.',
            );
            setStage('review');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>
                {stage === 'review' || stage === 'submitting'
                    ? `Review ${action || 'action'}`
                    : 'Advanced action'}
            </span>
            <span className={styles.spacer} />
        </div>
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

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>{action} sent</h2>
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

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
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
                    disabled={stage === 'submitting'}
                    error={submitError || undefined}
                />
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStage('compose')}
                        disabled={stage === 'submitting'}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={password.length === 0}
                    >
                        {descriptor ? `Sign on ${descriptor.displayName}` : 'Sign'}
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'compose'
    return wrap(
        <form onSubmit={handleReview} noValidate>
            {chainsWithAddresses.length > 1 ? (
                <label className={styles.pickerLabel}>
                    Chain
                    <select
                        className={styles.picker}
                        value={chainId}
                        onChange={(e) => setChainId(e.target.value)}
                    >
                        {chainsWithAddresses.map((cid) => {
                            const d = chainRegistry.get(cid);
                            return (
                                <option key={cid} value={cid}>
                                    {d ? `${d.displayName} (${d.networkKind})` : cid}
                                </option>
                            );
                        })}
                    </select>
                </label>
            ) : descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Signing from</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            <label className={styles.pickerLabel}>
                Action
                <select
                    className={styles.picker}
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                >
                    <option value="">— Pick an action —</option>
                    {(actions || []).map((a) => (
                        <option key={a} value={a}>
                            {a}
                            {ACTIONS_WITH_DEDICATED_FORMS.has(a)
                                ? ' (dedicated form available)'
                                : ''}
                        </option>
                    ))}
                </select>
            </label>

            {action && formats && Object.keys(formats).length > 1 ? (
                <label className={styles.pickerLabel}>
                    Format version
                    <select
                        className={styles.picker}
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                    >
                        <option value="">Auto-select (recommended)</option>
                        {Object.keys(formats).map((v) => (
                            <option key={v} value={v}>
                                v{v} — {formats[v]}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}

            {action && fields.length === 0 ? (
                <p className={styles.hint}>
                    This action takes no user-provided fields.
                </p>
            ) : null}

            {fields.map((fieldName) => {
                const base = baseFieldName(fieldName);
                const isRest = fieldName.startsWith(REST_PREFIX);
                const raw = values[base] ?? '';
                if (isRest) {
                    return (
                        <label key={fieldName} className={styles.pickerLabel}>
                            {base} (one per line or comma-separated)
                            <textarea
                                className={styles.picker}
                                value={raw}
                                onChange={(e) => handleFieldChange(base, e.target.value)}
                                rows={4}
                                spellCheck={false}
                                autoCapitalize="none"
                                autoCorrect="off"
                            />
                        </label>
                    );
                }
                return (
                    <Input
                        key={fieldName}
                        label={base}
                        value={raw}
                        onChange={(e) => handleFieldChange(base, e.target.value)}
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                );
            })}

            {validation && !validation.valid && validation.errors.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    {validation.errors.map((err, i) => (
                        <p key={i} className={styles.warning}>
                            {typeof err === 'string'
                                ? err
                                : err?.message || JSON.stringify(err)}
                        </p>
                    ))}
                </div>
            ) : null}

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}

            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !action}
                >
                    Preview
                </Button>
            </div>
        </form>,
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

function baseFieldName(fieldName) {
    return fieldName.startsWith(REST_PREFIX)
        ? fieldName.substring(REST_PREFIX.length)
        : fieldName;
}

// Compose the final params object submitted to the SDK. Rest-fields
// split their textarea value on newlines/commas; scalars trim; empty
// strings drop out (the SDK treats missing fields as default).
function buildParams(fields, values, version) {
    /** @type {Record<string, unknown>} */
    const out = {};
    if (version !== '' && version !== null && version !== undefined) {
        out.VERSION = String(version);
    }
    for (const fieldName of fields) {
        const base = baseFieldName(fieldName);
        const raw = values[base];
        if (raw === undefined || raw === null) continue;
        if (fieldName.startsWith(REST_PREFIX)) {
            const parts = String(raw)
                .split(/[\r\n,]+/g)
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            if (parts.length > 0) out[base] = parts;
        } else {
            const trimmed = String(raw).trim();
            if (trimmed.length > 0) out[base] = trimmed;
        }
    }
    return out;
}
