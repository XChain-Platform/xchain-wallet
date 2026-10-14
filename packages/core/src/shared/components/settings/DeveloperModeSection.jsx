// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DeveloperModeSection (§35.1 + §48): Developer Mode panel.
//
// Live:
//   - Developer Mode master toggle (`settings.developerMode`). Gates
//     non-Mainnet choices, endpoint overrides, local controls, and
//     diagnostics. Turning it off also returns the wallet to Mainnet.
//   - Learn Mode toggle (`settings.learnMode`). Drives explanatory
// copy on confirmation screens. a later change gave it its first reader:
//     DisplayPrefsGate stamps it on <html> and <LearnNote> renders the
//     copy on the standard confirmation surface.
//   - Auto-approve localhost dApps (`settings.autoApproveLocalhost`).
//     §48.6 / G151: when both this and Developer Mode are on,
//     `bridge.connect` from localhost / 127.0.0.1 / [::1] origins
//     skips the approval prompt.
//   - Localhost auto-sign timeout (`settings.autoSignLocalhostMs`).
//     §48.6 / Cluster Q FOLLOWUP 3: a separate opt-in that, once set to
//     5 min / 1 hour, lets a localhost sign request reuse the password
//     from a prior approval (held in service-worker memory only) instead
//     of prompting again. Off by default; a dev-only ergonomic.
//   - Regtest networks subsection (§48.3 / G149). Lists the bundled
//     regtest descriptors and lets the user activate one at runtime
//     via `messaging.activateChainRequest`. Idempotent re-activation
//     is a no-op. HW-aware (§17.4 / FOLLOWUP 1): when the wallet has a
//     paired hardware signer the row surfaces a SignerSelectForm; picking
//     the device passes its `signerId` and swaps the password field for
//     "check your device" copy, since HW activation derives the new
//     chain's address on the device instead of from a software seed.
//   - Custom chains subsection (§9.7 / Cluster Q FOLLOWUP 2). Paste a
//     JSON ChainDescriptor blob to add it to the running ChainRegistry;
//     persisted across SW restarts. Remove cleans both the persisted
//     record and the in-memory registry entry.
//   - Logs and diagnostics console (§48.5 / G150).
//
import { useEffect, useState } from 'react';
import { registry as registryLib, schemas } from '@xchain-wallet/core';
import { DEFAULT_MINER_URL } from '../../../branding/branding.js';
import { fundActiveWalletFromMiner } from '../../../flows/regtestFaucet.js';
import {
    Button,
    EmptyState,
    FormPage,
    FormSection,
    Input,
    SectionHeader,
    Select,
    Textarea,
} from '@xchain-wallet/core/ui';
import { ClipboardPasteButton } from '../../../ui/ClipboardPasteButton.jsx';
import { useMessaging } from '../../useMessaging.js';
import { useSettings } from '../../hooks/useSettings.js';
import { LogConsole } from '../LogConsole.jsx';
import { DiagnosticDetails } from '../DiagnosticDetails.jsx';
import { SignerSelectForm } from '../../routes/SignerSelectForm.jsx';
import {
    SettingsFieldRow,
    SettingsLoadError,
    Status,
    ToggleRow,
} from './_settingsPrimitives.jsx';
import styles from './DeveloperModeSection.module.css';
import { t } from '../../../i18n/index.js';

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

const chainRegistry = registryLib.defaultRegistry();

// Cluster Q FOLLOWUP 3: labels for the localhost auto-sign timeout options.
// Values come from the schema so the UI can never offer a timeout the
// validator would reject.
// Technical JSON sample shown in the paste box; code, not translatable copy.
const CHAIN_DESCRIPTOR_SAMPLE = '{\n  "id": "my-fork-regtest",\n  "coin": "myfork",\n  "networkKind": "regtest",\n  ...\n}';

// Built per call so a locale switch applies.
const autoSignLabels = () => ({
    [schemas.settings.AUTO_SIGN_LOCALHOST_OFF]: t('settings.developer.offAlwaysPrompt'),
    [schemas.settings.AUTO_SIGN_LOCALHOST_5M]: t('settings.developer.5Minutes'),
    [schemas.settings.AUTO_SIGN_LOCALHOST_1H]: t('settings.developer.1Hour'),
});

export function DeveloperModeSection({ activeWallet, activeAccount, onNavigateToMint, reload = reloadPage } = {}) {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const onToggle = async (field, next) => {
        try {
            await update({ [field]: next });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${field} update failed:`, err);
        }
    };

    const onDeveloperModeToggle = async (next) => {
        const returnToMainnet = !next && settings.activeNetwork !== 'mainnet';
        if (!returnToMainnet) {
            await onToggle('developerMode', next);
            return;
        }
        try {
            await update({ developerMode: false, activeNetwork: 'mainnet' });
            reload();
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('developerMode update failed:', err);
        }
    };

    const developerMode = Boolean(settings.developerMode);

    return (
        <FormPage as="div" sectioned fullWidth label={t('settings.developer.developerModeSettings')}>
            <FormSection title={t('settings.developer.developerOptions')}>
                <ToggleRow
                    label={t('settings.developer.developerMode')}
                    hint={t('settings.developer.unlocksTestNetworksEndpointOverrides')}
                    checked={developerMode}
                    onChange={onDeveloperModeToggle}
                />
                <ToggleRow
                    label={t('settings.developer.learnMode')}
                    hint={t('settings.developer.addsPlainLanguageExplanationsTo')}
                    checked={Boolean(settings.learnMode)}
                    onChange={(v) => onToggle('learnMode', v)}
                />
                {developerMode ? (
                    <ToggleRow
                        label={t('settings.developer.showVariantPopover')}
                        hint={t('settings.developer.inTheWebAppDisplay')}
                        checked={Boolean(settings.showVariantBadge)}
                        onChange={(v) => onToggle('showVariantBadge', v)}
                    />
                ) : null}
            </FormSection>
            {developerMode ? (
                <>
                    <RegtestNetworksRow
                        developerMode
                        fees={settings.fees}
                        activeWallet={activeWallet}
                    />
                    <RegtestFaucetRow
                        developerMode
                        fees={settings.fees}
                        activeWallet={activeWallet}
                        activeAccount={activeAccount}
                        onNavigateToMint={onNavigateToMint}
                    />
                    <CustomChainsRow developerMode />
                    <FormSection title={t('settings.developer.localDappControls')}>
                        <ToggleRow
                            label={t('settings.developer.autoApproveLocalhostDapps')}
                            hint={t('settings.developer.letLocalDevelopmentAppsConnect')}
                            checked={Boolean(settings.autoApproveLocalhost)}
                            disabled={!settings.developerMode}
                            onChange={(v) => onToggle('autoApproveLocalhost', v)}
                        />
                        <AutoSignLocalhostRow
                            developerMode
                            value={settings.autoSignLocalhostMs}
                            onChange={(v) => onToggle('autoSignLocalhostMs', v)}
                        />
                    </FormSection>
                    <LogConsoleRow developerMode />
                </>
            ) : null}
        </FormPage>
    );
}

function reloadPage() {
    if (typeof globalThis.location?.reload === 'function') globalThis.location.reload();
}

// The timeout options come from the schema so the control cannot persist an unsupported value.
function AutoSignLocalhostRow({ developerMode, value, onChange }) {
    const current = schemas.settings.AUTO_SIGN_LOCALHOST_OPTIONS.includes(value)
        ? value
        : schemas.settings.AUTO_SIGN_LOCALHOST_OFF;
    return (
        <SettingsFieldRow
            label={t('settings.developer.cachePasswordForLocalhostAuto')}
            hint={t('settings.developer.inDeveloperModeKeepAn')}
        >
            <Select
                value={current}
                disabled={!developerMode}
                onChange={(e) => onChange(Number(e.target.value))}
                className={styles.compactSelect}
            >
                {/* Native option elements provide the choices exposed by the style guide Select. */}
                {schemas.settings.AUTO_SIGN_LOCALHOST_OPTIONS.map((ms) => (
                    <option key={ms} value={ms}>{autoSignLabels()[ms]}</option>
                ))}
            </Select>
        </SettingsFieldRow>
    );
}

function LogConsoleRow({ developerMode }) {
    const [open, setOpen] = useState(false);
    return (
        <FormSection
            title={t('settings.developer.logsAndDiagnosticsConsole')}
            description={(
                <>
                    {t('settings.developer.processWideRingBufferOf')}
                    {!developerMode ? t('settings.developer.turnDeveloperModeOnTo') : ''}
                </>
            )}
        >
            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={null}
                    onClick={() => setOpen((v) => !v)}
                    disabled={!developerMode}
                    aria-expanded={open && developerMode}
                    aria-controls="settings-log-console"
                >
                    {open ? t('settings.developer.hide') : t('settings.developer.show')}
                </Button>
            </div>
            {open && developerMode ? <div id="settings-log-console"><LogConsole /></div> : null}
        </FormSection>
    );
}

function RegtestNetworksRow({ developerMode, fees, activeWallet }) {
    const regtests = chainRegistry.supportedChains()
        .filter((d) => d.networkKind === 'regtest')
        .sort((a, b) => a.coin.localeCompare(b.coin));
    if (regtests.length === 0) return null;
    return (
        <FormSection
            title={t('settings.developer.regtestNetworks')}
            description={(
                <>
                    {t('settings.developer.activateABundledRegtestDescriptor')}
                    {!developerMode ? t('settings.developer.turnDeveloperModeOnTo2') : ''}
                </>
            )}
        >
            {/* The style guide has no compact embedded list for network activation rows. */}
            <ul className={styles.list}>
                {regtests.map((d) => (
                    <li key={d.id}>
                        <RegtestRow
                            descriptor={d}
                            isActive={Boolean(fees && fees[d.id])}
                            disabled={!developerMode}
                            activeWallet={activeWallet}
                        />
                    </li>
                ))}
            </ul>
        </FormSection>
    );
}

export function RegtestRow({ descriptor, isActive, disabled, activeWallet }) {
    const { messaging } = useMessaging();
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [statusText, setStatusText] = useState(/** @type {string | null} */ (null));
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));
    const [skippedAccounts, setSkippedAccounts] = useState(
        /** @type {Array<{ subject: string, message: string }>} */ ([]),
    );
    const [activated, setActivated] = useState(Boolean(isActive));
    // §17.4 / FOLLOWUP 1: signer selection. null = the implicit software
    // seed (password path); a non-null signerId names a paired HW signer,
    // which activates through the device instead of a wallet password.
    const [signerId, setSignerId] = useState(/** @type {string | null} */ (null));
    const isHardware = Boolean(signerId);
    const walletId = activeWallet?.id || null;

    useEffect(() => {
        if (isActive) setActivated(true);
    }, [isActive]);

    const onActivate = async (event) => {
        event.preventDefault();
        if (busy) return;
        if (!walletId) {
            setErrorText('No active wallet is available for network activation.');
            return;
        }
        if (typeof messaging?.activateChainRequest !== 'function') {
            setErrorText('Activation is not wired in this shell yet.');
            return;
        }
        // Hardware signers derive the new chain's address on the device,
        // so they need no wallet password; software seeds still do.
        if (!isHardware && password.length === 0) {
            setErrorText('Wallet password is required.');
            return;
        }
        setBusy(true);
        setErrorText(null);
        setStatusText(null);
        setSkippedAccounts([]);
        try {
            const r = await messaging.activateChainRequest({
                walletId,
                chainId: descriptor.id,
                password: isHardware ? undefined : password,
                signerId: signerId || undefined,
            });
            const created = Array.isArray(r?.addresses) ? r.addresses.length : 0;
            const skipped = Array.isArray(r?.skippedAccountDetails)
                ? r.skippedAccountDetails.map((account) => ({
                    subject: account.name || account.accountId,
                    message: `Already has an address on ${descriptor.displayName}.`,
                }))
                : [];
            setSkippedAccounts(skipped);
            setStatusText(
                created > 0
                    ? t('settings.developer.activatedDerived', { count: created })
                    : 'Already activated. No new addresses needed.',
            );
            setActivated(true);
            setPassword('');
            setOpen(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setErrorText(isBadPassword ? 'Incorrect password.' : (err?.message || 'Activation failed.'));
        } finally {
            setBusy(false);
        }
    };

    const onCancel = () => {
        setOpen(false);
        setPassword('');
        setSignerId(null);
        setErrorText(null);
    };

    return (
        <section className={styles.entry}>
            <SectionHeader
                as="h3"
                title={descriptor.displayName}
                description={t('settings.developer.explorer', { id: descriptor.id, value: descriptor.explorer?.defaultUrl, value2: descriptor.explorer?.defaultPort })}
                trailing={activated ? (
                    <span className={styles.active}>{t('settings.developer.active')}</span>
                ) : (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={null}
                        onClick={() => setOpen(true)}
                        disabled={disabled || open}
                    >
                        {t('settings.developer.activate')}
                    </Button>
                )}
            />
            {open ? (
                <form onSubmit={onActivate} className={styles.form}>
                    {/* SignerSelectForm renders nothing when the wallet has no
                        paired HW signer (auto-resolves to software), so software
                        wallets keep the original password-only affordance. */}
                    {walletId ? (
                        <SignerSelectForm
                            walletId={walletId}
                            value={signerId}
                            onChange={setSignerId}
                            disabled={busy}
                        />
                    ) : null}
                    {isHardware ? (
                        <div
                            role="note"
                            style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' }}
                        >
                            {t('settings.developer.derivingTheFirst')} {descriptor.displayName} {t('settings.developer.addressRoundTripsToYour')}
                        </div>
                    ) : (
                        <Input
                            type="password"
                            enterKeyHint="go"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('send.gated.passwordLabel')}
                            autoComplete="current-password"
                            disabled={busy}
                            aria-label={t('settings.developer.activationPassword', { displayName: descriptor.displayName })}
                        />
                    )}
                    <div className={styles.actions}>
                        <Button type="submit" size="sm" icon={null} disabled={busy || (!isHardware && password.length === 0)}>
                            {busy ? (isHardware ? t('settings.developer.checkYourDevice') : t('settings.developer.activating')) : t('settings.developer.activate2')}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" icon={null} onClick={onCancel} disabled={busy}>
                            {t('common.cancel')}
                        </Button>
                    </div>
                </form>
            ) : null}
            {statusText ? <Status text={statusText} /> : null}
            <DiagnosticDetails
                summary={t('settings.developer.accountsNotChanged', { length: skippedAccounts.length })}
                items={skippedAccounts}
            />
            {errorText ? <Status text={errorText} tone="error" /> : null}
        </section>
    );
}

// Regtest faucet: dev-only convenience for local testing. Two independent
// mechanisms, because XCHAIN is a protocol-level asset the miner can't
// touch (see flows/regtestFaucet.js header comment):
//   - "Get test <COIN>" hits xchain-regtest-miner's send_funds JSON-RPC
//     directly (fetch, CORS-open on local stacks, no signing).
//   - "Mint test XCHAIN" hands off to the real MintForm flow (via
//     onNavigateToMint) since minting is a signed protocol action and
//     XCHAIN only exists on the bitcoin chain (XCHAIN_GENESIS.md).
function RegtestFaucetRow({ developerMode, fees, activeWallet, activeAccount, onNavigateToMint }) {
    const activeRegtests = chainRegistry.supportedChains()
        .filter((d) => d.networkKind === 'regtest' && fees && fees[d.id]);
    if (activeRegtests.length === 0) return null;
    // Prefer bitcoin-regtest as the default target (it's the only chain
    // XCHAIN can exist on), otherwise the first activated regtest chain.
    const descriptor = activeRegtests.find((d) => d.coin === 'bitcoin') || activeRegtests[0];
    const coinTicker = PROTOCOL_COIN_TICKER[descriptor.coin] || descriptor.coin;

    return (
        <RegtestFaucetForm
            developerMode={developerMode}
            descriptor={descriptor}
            coinTicker={coinTicker}
            activeWallet={activeWallet}
            activeAccount={activeAccount}
            onNavigateToMint={onNavigateToMint}
        />
    );
}

function RegtestFaucetForm({
    developerMode,
    descriptor,
    coinTicker,
    activeWallet,
    activeAccount,
    onNavigateToMint,
}) {
    const { messaging } = useMessaging();

    const [minerUrl, setMinerUrl] = useState(DEFAULT_MINER_URL);
    const [amount, setAmount] = useState('10');
    const [busy, setBusy] = useState(false);
    const [statusText, setStatusText] = useState(/** @type {string | null} */ (null));
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));

    const onGetFunds = async (event) => {
        event.preventDefault();
        if (busy) return;
        const amountNumber = Number(amount);
        if (amount.trim() === '' || !Number.isFinite(amountNumber) || amountNumber <= 0) {
            setErrorText(`Enter an amount of ${coinTicker} greater than 0.`);
            return;
        }
        setBusy(true);
        setStatusText(null);
        setErrorText(null);
        try {
            const result = await fundActiveWalletFromMiner({
                messaging,
                walletId: activeWallet?.id,
                accountId: activeAccount?.id,
                chainId: descriptor.id,
                chainDisplayName: descriptor.displayName,
                minerUrl,
                amount: amountNumber,
            });
            if (!result.ok) throw new Error(result.error || 'Funding failed.');
            setStatusText(`Sent ${amount} ${coinTicker} to ${result.address}. txid ${result.txid}. Waiting for the regtest miner to confirm it.`);
        } catch (err) {
            setErrorText(err?.message || 'Funding failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <FormSection
            title={t('settings.developer.regtestFaucet')}
            description={(
                <>
                    {t('settings.developer.localTestingOnlyGetTest')} {coinTicker}{t('settings.developer.asksTheXchainRegtestMiner')} {descriptor.displayName} {t('settings.developer.addressDirectlyNoSigningXchain')} {coinTicker} {t('settings.developer.alreadyToPayTheFee')}
                    {!developerMode ? t('settings.developer.turnDeveloperModeOnTo3') : ''}
                </>
            )}
        >
            <form onSubmit={onGetFunds} className={styles.form}>
                <Input
                    type="text"
                    label={t('settings.developer.minerUrl')}
                    enterKeyHint="next"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label={t('settings.developer.minerUrl')}
                    value={minerUrl}
                    onChange={(e) => setMinerUrl(e.target.value)}
                    disabled={!developerMode || busy}
                />
                <Input
                    type="text"
                    label={t('settings.developer.amount', { coinTicker })}
                    inputMode="decimal"
                    enterKeyHint="go"
                    aria-label={t('settings.developer.amount', { coinTicker })}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={!developerMode || busy}
                />
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        size="sm"
                        icon={null}
                        disabled={!developerMode || busy}
                    >
                        {busy ? t('settings.developer.sending') : t('settings.developer.getTest', { coinTicker })}
                    </Button>
                    {typeof onNavigateToMint === 'function' && descriptor.coin === 'bitcoin' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={null}
                            onClick={() => onNavigateToMint({ chainId: descriptor.id, tick: 'XCHAIN' })}
                            disabled={!developerMode || busy}
                        >
                            {t('settings.developer.mintTestXchain')}
                        </Button>
                    ) : null}
                </div>
            </form>
            {statusText ? <Status text={statusText} /> : null}
            {errorText ? <Status text={errorText} tone="error" /> : null}
        </FormSection>
    );
}

// §9.7 / Cluster Q FOLLOWUP 2: Custom chains subsection.
//
// Persisted user-added ChainDescriptor entries surfaced as a list with
// per-row Remove buttons + an "Add custom chain" form that accepts a
// JSON descriptor blob. The form is intentionally minimal: pasting a
// full ChainDescriptor JSON is the canonical path because the spec
// shape has 16+ fields (derivation paths, fee strategies, endpoints,
// adsDonationAddress, etc.). A guided form would be large and quickly
// drift from the validator. Validation runs in the host route
// (`chainRegistry.addCustomChain` → `validateChainDescriptor`); error
// messages here are forwarded verbatim so the user sees exactly which
// field failed.
function CustomChainsRow({ developerMode }) {
    const { messaging } = useMessaging();
    const [chains, setChains] = useState(/** @type {object[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [open, setOpen] = useState(false);
    const [pasted, setPasted] = useState('');
    const [busy, setBusy] = useState(false);
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));
    const [statusText, setStatusText] = useState(/** @type {string | null} */ (null));

    const refresh = async () => {
        if (typeof messaging?.listCustomChains !== 'function') {
            setChains([]);
            setLoading(false);
            return;
        }
        try {
            const r = await messaging.listCustomChains();
            setChains(Array.isArray(r?.descriptors) ? r.descriptors : []);
            setLoadError(null);
        } catch (err) {
            setLoadError(err?.message || 'Failed to load custom chains.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.listCustomChains !== 'function') {
            setChains([]);
            setLoading(false);
            return undefined;
        }
        messaging.listCustomChains()
            .then((r) => {
                if (cancelled) return;
                setChains(Array.isArray(r?.descriptors) ? r.descriptors : []);
                setLoadError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                setLoadError(err?.message || 'Failed to load custom chains.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [messaging]);

    const onAdd = async (event) => {
        event.preventDefault();
        if (busy) return;
        if (typeof messaging?.addCustomChain !== 'function') {
            setErrorText('addCustomChain is not wired in this shell yet.');
            return;
        }
        let descriptor;
        try {
            descriptor = JSON.parse(pasted);
        } catch (err) {
            setErrorText(`Invalid JSON: ${err?.message || 'parse failed'}`);
            return;
        }
        setBusy(true);
        setErrorText(null);
        setStatusText(null);
        try {
            const r = await messaging.addCustomChain({ descriptor });
            const id = r?.descriptor?.id || descriptor?.id || '(unknown)';
            // The host registered the chain in ITS realm; in the popup and
            // desktop renderer this realm's registry is a separate instance,
            // so install the accepted descriptor here too or the endpoint
            // editor and pickers keep omitting it until the next settings
            // read. The web shell shares one instance, where has() makes
            // this a no-op.
            try {
                const accepted = r?.descriptor ?? descriptor;
                if (typeof accepted?.id === 'string' && !chainRegistry.has(accepted.id)) {
                    chainRegistry.addCustom(accepted);
                }
            } catch { /* host already accepted the chain; the next read re-hydrates */ }
            // Say which descriptor the vault now holds, since a same-id add may keep the saved one.
            if (r?.restored) {
                setStatusText(`Restored saved chain "${id}". To change its descriptor, remove it and add it again.`);
            } else if (r?.replaced) {
                setStatusText(`Replaced saved chain "${id}" (the saved copy is no longer valid).`);
            } else {
                setStatusText(`Added "${id}".`);
            }
            setPasted('');
            setOpen(false);
            await refresh();
        } catch (err) {
            setErrorText(err?.message || 'Failed to add custom chain.');
        } finally {
            setBusy(false);
        }
    };

    const onRemove = async (chainId) => {
        if (busy) return;
        if (typeof messaging?.removeCustomChain !== 'function') {
            setErrorText('removeCustomChain is not wired in this shell yet.');
            return;
        }
        setBusy(true);
        setErrorText(null);
        setStatusText(null);
        try {
            await messaging.removeCustomChain({ chainId });
            // Mirror the removal into this realm's registry; only a
            // user-added entry is touched (removeCustom throws for bundled ids).
            try {
                if (chainRegistry.get(chainId)?.isUserAdded) chainRegistry.removeCustom(chainId);
            } catch { /* bundled or already gone: nothing to mirror */ }
            setStatusText(`Removed "${chainId}".`);
            await refresh();
        } catch (err) {
            setErrorText(err?.message || 'Failed to remove custom chain.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <FormSection
            title={t('settings.developer.customChains')}
            description={(
                <>
                    {t('settings.developer.plugInANonBundled')}
                    {!developerMode ? t('settings.developer.turnDeveloperModeOnTo4') : ''}
                </>
            )}
        >
            {loadError ? <Status text={loadError} tone="error" /> : null}
            {!loading && chains.length === 0 && !loadError ? (
                <EmptyState title={t('settings.developer.noCustomChainsYet')} titleAs="h3" body={t('settings.developer.chainsYouAddHereAppear')} />
            ) : null}
            {chains.length > 0 ? (
                <>
                    {/* The style guide has no compact embedded list for custom-chain rows. */}
                    <ul className={styles.list}>
                        {chains.map((d) => (
                            <li key={d?.id} className={styles.entry}>
                                <SectionHeader
                                    as="h3"
                                    title={d?.displayName || d?.id}
                                    description={`${d?.id}${d?.networkKind ? ` · ${d.networkKind}` : ''}`}
                                    trailing={(
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            icon={null}
                                            onClick={() => onRemove(d?.id)}
                                            disabled={!developerMode || busy}
                                            aria-label={t('settings.developer.removeCustomChain', { value: d?.id })}
                                        >
                                            {t('send.recipient.remove')}
                                        </Button>
                                    )}
                                />
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
            {open ? (
                <form onSubmit={onAdd} className={styles.form}>
                    <Textarea
                        id="custom-chain-descriptor"
                        label={t('settings.developer.customChainDescriptorJson')}
                        hint={t('settings.developer.pasteAFullChaindescriptorJson')}
                        value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        placeholder={CHAIN_DESCRIPTOR_SAMPLE}
                        rows={8}
                        spellCheck={false}
                        disabled={busy}
                        className={styles.descriptor}
                    />
                    <ClipboardPasteButton
                        onPaste={setPasted}
                        disabled={busy}
                        label={t('settings.developer.pasteCustomChainDescriptor')}
                    />
                    <div className={styles.actions}>
                        <Button type="submit" size="sm" icon={null} disabled={busy || pasted.length === 0}>
                            {busy ? t('settings.developer.adding') : t('settings.developer.addChain')}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={null}
                            onClick={() => { setOpen(false); setPasted(''); setErrorText(null); }}
                            disabled={busy}
                        >
                            {t('common.cancel')}
                        </Button>
                    </div>
                </form>
            ) : (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={null}
                    onClick={() => setOpen(true)}
                    disabled={!developerMode || busy}
                    className={styles.startAction}
                >
                    {t('settings.developer.addCustomChain')}
                </Button>
            )}
            {statusText ? <Status text={statusText} /> : null}
            {errorText ? <Status text={errorText} tone="error" /> : null}
        </FormSection>
    );
}
