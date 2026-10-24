// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English string dictionary (§54 / G173 ICU format), split by namespace.
//
// Keys stay flat and dotted (`home.lock`); the part before the first dot
// names the file that holds the key: `settings.*` lives in settings.js. Two
// startup files break that rule on purpose: errors.js holds the error and
// fallback states, and firstPaint.js holds the keys from later namespaces that
// the first screens render. i18n/index.js loads the startup files (common,
// shell, onboarding, locked, home, errors, firstPaint) at boot. Every other
// file registers itself when a module that renders its keys imports it, so a
// lazy route's copy arrives with the route's chunk and is in place before the
// route renders. test/unit/i18n/namespaceImports.test.js holds both rules.
//
// Each key lives in exactly one file. JavaScript silently keeps the last of
// two identical keys, so test/smoke/core/i18n.smoke.js scans every file here
// and fails on a repeat.
//
// Plural / select handling uses ICU MessageFormat-compatible syntax:
//
//   '{count, plural, one {# address} other {# addresses}}'
//   '{kind, select, mainnet {Live} testnet {Testnet} other {Other}}'
//
// `t()` in `i18n/index.js` renders the matched template through
// formatjs (`IntlMessageFormat` from `intl-messageformat`), so the full
// ICU grammar is available: plural, select, selectordinal, number and
// date skeletons, nested patterns and offset. The plural/select-only
// subset the wallet shipped before v0.334 survives as `legacyFormat()`
// in `i18n/index.js`, and it is reached on two routes: formatjs throws
// while parsing or rendering the template, or the caller omits an
// argument formatjs coerces (a `number`, `plural`, `selectordinal`,
// `date` or `time` one). The second route prints each missing argument
// as its bare `{name}` token and applies no number formatting, so pass
// every coerced argument a template names.
//
// This module merges every namespace into the whole English dictionary, for
// tooling, tests and the locales derived from English (pseudo-rtl). The app
// never imports it at startup.
//
// Adding a new locale: build one dictionary holding every key `en` holds
// here, save it as `locales/<bcp47>/index.js` with a default export, and
// the lazy locale loader in i18n/index.js discovers it; or call
// `registerLocale('<bcp47>', dictionary)` from app boot.
//
// Until a locale is registered, missing keys fall back to English.

import accountPicker from './accountPicker.js';
import actionDetail from './actionDetail.js';
import actionsMenu from './actionsMenu.js';
import addressList from './addressList.js';
import adsNotice from './adsNotice.js';
import alerts from './alerts.js';
import backupReminder from './backupReminder.js';
import balanceList from './balanceList.js';
import balances from './balances.js';
import betCreate from './betCreate.js';
import bridgeOrigin from './bridgeOrigin.js';
import commandPalette from './commandPalette.js';
import common from './common.js';
import components from './components.js';
import createOrder from './createOrder.js';
import createWallet from './createWallet.js';
import crossChainOrder from './crossChainOrder.js';
import crossChainSwap from './crossChainSwap.js';
import demo from './demo.js';
import desktopUpdate from './desktopUpdate.js';
import dispenserExplorer from './dispenserExplorer.js';
import dispenserForm from './dispenserForm.js';
import errors from './errors.js';
import execute from './execute.js';
import extension from './extension.js';
import firstPaint from './firstPaint.js';
import flows from './flows.js';
import gatedPublish from './gatedPublish.js';
import governance from './governance.js';
import history from './history.js';
import home from './home.js';
import importWallet from './importWallet.js';
import issue from './issue.js';
import keyboard from './keyboard.js';
import locked from './locked.js';
import manageToken from './manageToken.js';
import market from './market.js';
import multisig from './multisig.js';
import onboarding from './onboarding.js';
import palette from './palette.js';
import parallelComposer from './parallelComposer.js';
import pending from './pending.js';
import receive from './receive.js';
import renameAccount from './renameAccount.js';
import renameWallet from './renameWallet.js';
import routes from './routes.js';
import scan from './scan.js';
import send from './send.js';
import settings from './settings.js';
import shell from './shell.js';
import signerSelect from './signerSelect.js';
import stakeNew from './stakeNew.js';
import transactionStatus from './transactionStatus.js';
import txTimeline from './txTimeline.js';
import ui from './ui.js';
import undoSend from './undoSend.js';
import verifySignature from './verifySignature.js';
import walletDetails from './walletDetails.js';
import walletPicker from './walletPicker.js';

export const en = {
    ...accountPicker,
    ...actionDetail,
    ...actionsMenu,
    ...addressList,
    ...adsNotice,
    ...alerts,
    ...backupReminder,
    ...balanceList,
    ...balances,
    ...betCreate,
    ...bridgeOrigin,
    ...commandPalette,
    ...common,
    ...components,
    ...createOrder,
    ...createWallet,
    ...crossChainOrder,
    ...crossChainSwap,
    ...demo,
    ...desktopUpdate,
    ...dispenserExplorer,
    ...dispenserForm,
    ...errors,
    ...execute,
    ...extension,
    ...firstPaint,
    ...flows,
    ...gatedPublish,
    ...governance,
    ...history,
    ...home,
    ...importWallet,
    ...issue,
    ...keyboard,
    ...locked,
    ...manageToken,
    ...market,
    ...multisig,
    ...onboarding,
    ...palette,
    ...parallelComposer,
    ...pending,
    ...receive,
    ...renameAccount,
    ...renameWallet,
    ...routes,
    ...scan,
    ...send,
    ...settings,
    ...shell,
    ...signerSelect,
    ...stakeNew,
    ...transactionStatus,
    ...txTimeline,
    ...ui,
    ...undoSend,
    ...verifySignature,
    ...walletDetails,
    ...walletPicker,
};

// Default export so the lazy locale loader (`import.meta.glob(..., {
// import: 'default' })` in i18n/index.js) can pull the whole dictionary as
// a code-split chunk.
export default en;
