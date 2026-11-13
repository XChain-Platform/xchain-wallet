// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `coSigner.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- agent account review -----------------------------------
    'coSigner.provision.noLimit': 'No limit',

    // --- allowed tokens rule ------------------------------------
    'coSigner.policy.tokens.title': 'Allowed tokens',
    'coSigner.policy.tokens.help': 'Choose which tokens the agent may move. The network coin, such as BTC, is always allowed for fees and orders.',
    'coSigner.policy.tokens.helpAria': 'About allowed tokens',
    'coSigner.policy.tokens.legend': 'Tokens the agent may move',
    'coSigner.policy.tokens.any': 'Any token',
    'coSigner.policy.tokens.anyHelp': 'The agent may move every token this account holds.',
    'coSigner.policy.tokens.noneHelp': 'The agent may move only the network coin, never a token.',
    'coSigner.policy.tokens.list': 'Only These Tokens',
    'coSigner.policy.tokens.listHelp': 'The agent may move only the tokens you list.',
    'coSigner.policy.tokens.fieldHelp': 'Enter token tickers separated by commas, for example MYTOKEN, XCHAIN.',
    'coSigner.policy.tokens.nonePicked': 'None listed',
    'coSigner.policy.tokens.errorEmpty': 'List at least one allowed token, or choose Any token or None.',
    'coSigner.policy.tokens.errorTicker': "{tick} isn't a token ticker. Use letters, digits and . - _ only.",
    'coSigner.policy.tokens.numbers': 'Token numbers saved with these rules: {list}',
    'coSigner.policy.tokens.numberEntry': '{tick} number {id}',
    'coSigner.policy.tokens.notFound': "{tick} wasn't found on this network. Check the ticker or remove it, then save again.",
    'coSigner.policy.tokens.notChecked': "{tick} couldn't be checked right now. Try saving again in a moment.",
    'coSigner.policy.tokens.sharedNumber': '{tick} has the same token number as another ticker in these rules. Keep only one of them.',
    'coSigner.policy.tokens.saveError': "Some tokens in these rules couldn't be matched to their token numbers. Fix the marked tokens, then save again.",
    'coSigner.policy.tokens.lookupUnavailable': "Token numbers can't be checked from here, so rules that name tokens can't be saved.",

    // --- agent account list and page ----------------------------
    'coSigner.network': 'Network: {network}',
    'coSigner.balanceLoading': 'Loading balance…',
    'coSigner.tokenCount': '{count, plural, one {# token} other {# tokens}}',
    'coSigner.status.off': 'Turned off',
    'coSigner.detail.title': 'Agent Account',
    'coSigner.detail.view': 'Agent account view',
    'coSigner.detail.fund': 'Fund',
    'coSigner.detail.withdraw': 'Withdraw',
    'coSigner.detail.withdrawLocked': 'Withdraw needs the agent to co-sign, so the agent starts it.',
    'coSigner.detail.editRules': 'Edit Rules',
    'coSigner.detail.copyAddress': 'Copy Address',
    'coSigner.detail.copied': 'Address copied.',
    'coSigner.detail.turnOff': 'Turn Off',
    'coSigner.detail.turnOn': 'Turn On',
    'coSigner.detail.holdings': 'Holdings',
    'coSigner.detail.notAllowedTokenTag': "Not allowed: the agent can't move it",
    'coSigner.detail.activityEmpty': 'No requests signed in the current window yet.',
    'coSigner.detail.activitySigned': 'Signed · {when}',
    'coSigner.detail.activityNote': 'Activity lists the requests you approved in the current limit window.',
    'coSigner.detail.activityNoRecord': 'This wallet records approved requests only for accounts with a rolling limit. Add one under Edit Rules to see activity here.',
    'coSigner.detail.pendingTitle': 'Wants to {what}',
    'coSigner.detail.pendingWhy': 'Waiting on your approval',
    'coSigner.detail.pendingOutside': 'Outside the rules: {reason}',
    'coSigner.detail.refuse': 'Refuse',
    'coSigner.detail.fundAddress': 'Fund this address',
    'coSigner.detail.allowedActions': 'Allowed actions',
    'coSigner.detail.allowedRecipients': 'Allowed recipients',
    'coSigner.detail.anyRecipient': 'Any',
    'coSigner.detail.recipientCount': '{count, plural, one {# address} other {# addresses}}',
    'coSigner.detail.rollingLimit': 'Rolling limit',
    'coSigner.detail.windowActivity': 'Activity in current window',
    'coSigner.detail.windowCount': '{count, plural, one {# action} other {# actions}}',
    'coSigner.detail.kind2of2': '2-of-2',
    'coSigner.detail.kind2of3': '2-of-3 with recovery',
    'coSigner.detail.refuseFailed': 'Failed to refuse the request.',
    'coSigner.detail.openFailed': 'Failed to open the request.',
    'coSigner.detail.windowClosed': 'This request\'s approval window is no longer open. Ask the agent to send the request again.',
    'coSigner.detail.copyFailed': 'Failed to copy the address.',
    'coSigner.detail.agentKey': 'Agent key',
    'coSigner.detail.walletKey': 'This wallet\'s key',
    'coSigner.detail.recoveryKey': 'Recovery key',
    'coSigner.detail.activeHint': 'Every request waits for your approval here; the rules refuse anything outside them.',
    'coSigner.detail.offHint': 'This account is turned off. Every request is refused until you turn it on.',
};

addEnglish(messages);

export default messages;
