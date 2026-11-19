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
//     the Regtest network choice, endpoint overrides, local controls, and
//     diagnostics. Turning it off while on Regtest returns the wallet to
//     Mainnet; Testnet is open to everyone and stays selected.
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
//   - Regtest networks, custom networks and the regtest faucet live on
//     the Test Networks pages (TestNetworksPages.jsx), opened from
//     Developer options (operator picks 2026-11-14).
//   - Logs and diagnostics console (§48.5 / G150).
//
import { schemas } from '@xchain-wallet/core';
import {
    FormPage,
    FormSection,
    Icon,
    ListRow,
    Notice,
    PageHeader,
    PageNotice as Status,
    Screen,
    Select,
} from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { useMessaging, screenVariantFor } from '../../useMessaging.js';
import { ListFilterMenu } from '../ListFilterMenu.jsx';
import { LogConsole, LogConsoleControls, useLogConsole } from '../LogConsole.jsx';
import { normalizeActiveNetwork } from '../../utils/activeNetworkSwitch.js';
import { titleCase } from '../../utils/titleCase.js';
import {
    SettingsFieldRow,
    SettingsLoadError,
    ToggleRow,
} from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/components.js';
import '../../../i18n/locales/en/settings.js';

// The custom-network error wording moved with the custom network pages;
// re-exported so existing importers keep one source.
export { customChainErrorText } from './TestNetworksPages.jsx';

// Cluster Q FOLLOWUP 3: labels for the localhost auto-sign timeout options.
// Values come from the schema so the UI can never offer a timeout the
// validator would reject.
// Built per call so a locale switch applies. The Developer options page's
// inline dropdown lists the same choices.
export const autoSignLabels = () => ({
    [schemas.settings.AUTO_SIGN_LOCALHOST_OFF]: t('settings.developer.offAlwaysPrompt'),
    [schemas.settings.AUTO_SIGN_LOCALHOST_5M]: t('settings.developer.5Minutes'),
    [schemas.settings.AUTO_SIGN_LOCALHOST_10M]: t('settings.developer.10Minutes'),
    [schemas.settings.AUTO_SIGN_LOCALHOST_1H]: t('settings.developer.1Hour'),
});

// The themed dropdown's choices, an icon each, shared by this section and the
// Developer options row so the two lists never differ.
export const autoSignOptions = () => schemas.settings.AUTO_SIGN_LOCALHOST_OPTIONS.map((ms) => {
    const ChoiceIcon = ms === schemas.settings.AUTO_SIGN_LOCALHOST_OFF ? Icon.XIcon : Icon.ClockIcon;
    return { value: String(ms), label: autoSignLabels()[ms], icon: <ChoiceIcon /> };
});

export function DeveloperModeSection({
    onNavigateToAdvanced,
    onNavigateToActionQueue,
    reload = reloadPage,
    tools = true,
    // Learn mode is a switch on the Appearance page (2026-11-13); that
    // page's Developer mode row passes learn={false}.
    learn = true,
    // Opens the log console on its own page; without it the row is not shown.
    onOpenLogs,
} = {}) {
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

    // Regtest is the only network that needs Developer Mode, so turning it off
    // moves the wallet off Regtest and leaves a Mainnet or Testnet choice alone.
    const onDeveloperModeToggle = async (next) => {
        const returnToMainnet = !next && normalizeActiveNetwork(settings.activeNetwork) === 'regtest';
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
                {/* The page title already names the subject, so the switch reads as
                    an action; screen readers, which may reach it out of context,
                    hear the subject too. */}
                <ToggleRow
                    label={t('settings.toggle.turnOn')}
                    accessibleLabel={t('settings.developerMode.switchAccessibleLabel')}
                    help={t('settings.developer.unlocksTestNetworksEndpointOverrides')}
                    checked={developerMode}
                    onChange={onDeveloperModeToggle}
                />
                {learn ? (
                    <ToggleRow
                        label={t('settings.developer.learnMode')}
                        help={t('settings.developer.addsPlainLanguageExplanationsTo')}
                        checked={Boolean(settings.learnMode)}
                        onChange={(v) => onToggle('learnMode', v)}
                    />
                ) : null}
                {developerMode ? (
                    <ToggleRow
                        label={t('settings.developer.showVariantPopover')}
                        help={t('settings.developer.inTheWebAppDisplay')}
                        checked={Boolean(settings.showVariantBadge)}
                        onChange={(v) => onToggle('showVariantBadge', v)}
                    />
                ) : null}
            </FormSection>
            {/* Each tool opens its own page, so it is a drill-in row with the
                trailing chevron (G97), not a button. The Advanced page lists
                these rows itself and passes tools={false}. */}
            {tools ? (
                <FormSection title={t('settings.developer.tools')}>
                    {typeof onNavigateToAdvanced === 'function' ? (
                        <ListRow
                            onClick={onNavigateToAdvanced}
                            title={t('settings.developer.advancedAction')}
                            subtitle={t('settings.developer.advancedActionHint')}
                            aria-label={`${t('settings.developer.open')} ${t('settings.developer.advancedAction')}`}
                            chevron
                        />
                    ) : null}
                    {typeof onNavigateToActionQueue === 'function' ? (
                        <ListRow
                            onClick={onNavigateToActionQueue}
                            title={t('settings.developer.actionQueue')}
                            subtitle={t('settings.developer.actionQueueHint')}
                            aria-label={`${t('settings.developer.open')} ${t('settings.developer.actionQueue')}`}
                            chevron
                        />
                    ) : null}
                </FormSection>
            ) : null}
            {developerMode ? (
                <>
                    <FormSection title={t('settings.developer.localDappControls')}>
                        <ToggleRow
                            label={t('settings.developer.autoApproveLocalhostDapps')}
                            help={t('settings.developer.letLocalDevelopmentAppsConnect')}
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
                    {typeof onOpenLogs === 'function' ? <LogConsoleRow onOpen={onOpenLogs} /> : null}
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
            hint={t('settings.developer.autoSignLine')}
            help={t('settings.developer.inDeveloperModeKeepAn')}
        >
            <Select
                value={String(current)}
                disabled={!developerMode}
                onChange={(e) => onChange(Number(e.target.value))}
                options={autoSignOptions()}
            />
        </SettingsFieldRow>
    );
}

// The log console opens on its own page (G97 drill-in row), never expanding
// in place under the switches.
function LogConsoleRow({ onOpen }) {
    return (
        <FormSection title={t('settings.about.diagnostics')}>
            <ListRow
                onClick={onOpen}
                title={t('settings.developer.logsAndDiagnosticsConsole')}
                subtitle={t('settings.developer.logsRowHint')}
                chevron
            />
        </FormSection>
    );
}

const LOGS_BODY = { display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' };

/**
 * Developer mode > Logs and diagnostics console: the process-wide console
 * buffer, mounted only while this page is open. Developer Mode must be on.
 * The page draws its own title bar (Settings hands it Back): the level
 * toggles, the search, Copy all and Clear sit behind the title-bar filter
 * (G04, operator walk 2026-11-15), so the body is only the note and the list.
 *
 * @param {object} [props]
 * @param {() => void} [props.onBack]
 * @param {string} [props.backLabel]
 * @param {boolean} [props.nested]
 * @param {string} [props.variant]
 */
export function DeveloperLogsPage({ onBack, backLabel, nested = true, variant: variantProp } = {}) {
    const { shell } = useMessaging();
    const variant = variantProp || screenVariantFor(shell);
    const { settings, loading, error } = useSettings();
    const chrome = { onBack, backLabel, nested, variant };
    if (loading) return <LogsScreen {...chrome}><Status text={t('common.loading')} /></LogsScreen>;
    if (error) return <LogsScreen {...chrome}><SettingsLoadError error={error} /></LogsScreen>;
    if (!settings?.developerMode) {
        return (
            <LogsScreen {...chrome}>
                <Notice tone="info" flush>
                    {t('settings.developer.processWideRingBufferOf')}
                    {t('settings.developer.turnDeveloperModeOnTo')}
                </Notice>
            </LogsScreen>
        );
    }
    return <LiveLogsScreen {...chrome} />;
}

/** The console itself, mounted (and the buffer attached) only with Developer Mode on. */
function LiveLogsScreen(chrome) {
    const state = useLogConsole();
    const filter = (
        <ListFilterMenu
            query={state.search}
            onQueryChange={state.setSearch}
            active={state.levelsNarrowed}
            searchPlaceholder={t('components.logConsole.searchMessages')}
            searchLabel={t('components.logConsole.searchLogMessages')}
            resultsId="settings-log-console"
        >
            <LogConsoleControls state={state} />
        </ListFilterMenu>
    );
    return (
        <LogsScreen {...chrome} filterMenu={filter}>
            <Notice tone="info" flush>{t('settings.developer.processWideRingBufferOf')}</Notice>
            <div id="settings-log-console"><LogConsole state={state} /></div>
        </LogsScreen>
    );
}

function LogsScreen({ onBack, backLabel, nested, variant, filterMenu = null, children }) {
    const header = (
        <PageHeader
            nested={nested}
            onBack={onBack}
            backLabel={backLabel}
            title={titleCase(t('settings.developer.logsAndDiagnosticsConsole'))}
            trailing={filterMenu}
        />
    );
    return (
        <Screen variant={variant} header={header} scrollKey="developer-logs" restoreScroll={false}>
            <div style={LOGS_BODY} data-developer-logs-body="">{children}</div>
        </Screen>
    );
}
