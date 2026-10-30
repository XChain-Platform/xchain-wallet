// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { en } from '../../packages/core/src/i18n/locales/en/index.js';
import { englishNamespaceSources } from './englishNamespaces.js';

// Source-reading contract tests match the English copy a component renders.
// Copy moved out of JSX literals by the i18n sweep now lives in the locale
// dictionary behind t('key'), so these tests read the source with those plain
// calls swapped back to English: `{t('k')}` in JSX content becomes the bare
// text, `attr={t('k')}` becomes `attr="text"`, a lazy
// `get label() { return t('k'); }` table entry becomes `label: 'text'`,
// `prop: t('k')` becomes `prop: 'text'`, and any other plain t('k') becomes the
// quoted English string. Calls with arguments and keys that predate the sweep
// are left as written, so tests that audit t() usage keep seeing it.
// Each namespace file under locales/en/ lists its swept keys after the sweep
// marker.
const SWEEP_MARKER = '// Copy moved out of JSX literals by the i18n sweep.';
const sweepKeys = new Set(
    englishNamespaceSources().flatMap(({ source }) => (source.includes(SWEEP_MARKER)
        ? [...source.slice(source.indexOf(SWEEP_MARKER)).matchAll(/^ {4}'([^']+)':/gm)].map((match) => match[1])
        : [])),
);
// Dictionary keys that predate the sweep but that it started using again for
// copy it moved out of JSX, because the English text was identical.
const REUSED_KEYS = new Set([
    'common.confirm',
    'common.tryAgain',
    'accountPicker.defaultName',
    'accountPicker.title',
    'actionDetail.title',
    'adsNotice.continue',
    'adsNotice.title',
    'alerts.notificationsTitle',
    'execute.protocolFee',
    'extension.approval.reject',
    'extension.approval.requestingSite',
    'extension.connect.chains',
    'extensionBanner.notNow',
    'gatedPublish.review.summary.beforeFile',
    'history.contact.save',
    'history.copy.copied',
    'history.copy.walletAddress',
    'history.detail.more',
    'history.detail.openNewWindow',
    'history.empty.noActivityTitle',
    'history.empty.noAddressesTitle',
    'history.export.confirm',
    'history.export.open',
    'history.filters.last7Days',
    'history.recipients.noHoldersFound',
    'history.title',
    'home.addresses',
    'home.contracts',
    'home.lockWallet',
    'home.messaging',
    'home.receive',
    'home.retryBalances',
    'home.settings',
    'home.title',
    'importWallet.backToSetup',
    'importWallet.confirmPassword',
    'importWallet.import',
    'importWallet.openInTab',
    'importWallet.passphrase.help',
    'importWallet.passphrase.label',
    'importWallet.recoveryPhrase',
    'importWallet.title',
    'importWallet.wif.key',
    'issue.supply',
    'issue.ticker',
    'multisig.share.derivationPath',
    'onboarding.carousel.next',
    'pending.detail.technicalDetails',
    'pending.row.confirmed',
    'renameWallet.name',
    'scan.title',
    'send.advanced.none',
    'send.draft.discard',
    'send.fields.amount',
    'send.fields.chain',
    'send.fields.from',
    'send.fields.to',
    'send.fields.token',
    'send.gated.passwordLabel',
    'send.networkFee',
    'send.networkFeeValue',
    'send.recipient.remove',
    'send.saveRecipient.saving',
    'send.title',
    'send.txid',
    'send.walletUnlocked',
    'settings.network.label',
    'shell.markets.back',
    'shell.markets.selectAsset',
    'shell.settings.back',
    'signerSelect.title',
    'vaultUnavailable.wipeConfirm',
    'verifySignature.address',
    'verifySignature.verifying',
    'walletDetails.exitDemo',
    'walletDetails.name',
    'walletDetails.upgradeRecovery',
    'walletPicker.add',
]);
const swept = (key) => (sweepKeys.has(key) || REUSED_KEYS.has(key)) && key in en;
const quote = (text) => `'${text.replace(/'/g, "\\'")}'`;

export function withEnglishCopy(source) {
    return source
        .replace(/get (\w+)\(\) \{ return t\('([^']+)'\); \}/g, (match, prop, key) => (swept(key) ? `${prop}: ${quote(en[key])}` : match))
        .replace(/(\w+): t\('([^']+)'\)/g, (match, prop, key) => (swept(key) ? `${prop}: ${quote(en[key])}` : match))
        .replace(/=\{t\('([^']+)'\)\}/g, (match, key) => (swept(key) ? (en[key].includes('"') ? `={${quote(en[key])}}` : `="${en[key]}"`) : match))
        .replace(/\{t\('([^']+)'\)\}/g, (match, key) => (swept(key) ? en[key] : match))
        .replace(/\bt\('([^']+)'\)/g, (match, key) => (swept(key) ? quote(en[key]) : match));
}
