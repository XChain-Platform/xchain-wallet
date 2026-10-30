// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `extension.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- browser extension ---------------------------------------
    'extension.approval.loading': 'Loading approval request…',
    'extension.approval.interrupted':
        'This approval was interrupted. Return to the site and try again.',
    'extension.approval.unsupported': 'Unsupported approval request type.',
    'extension.popup.checkingPage': 'Checking page availability…',
    'extension.popup.unsupportedPage': "XChain Wallet can't connect to this page.",
    'extension.popup.unsupportedPageHint': 'Open a regular website to use the wallet.',
    'extension.approval.reject': 'Reject',
    'extension.approval.requestingSite': 'Requesting site',

    'extension.connect.title': 'Connect to XChain Wallet?',
    'extension.connect.approve': 'Approve',
    'extension.connect.declaredName': 'Site-provided name',
    'extension.connect.permissions': 'Requested permissions',
    'extension.connect.permission.accounts':
        'View the accounts you select, including their addresses and balances',
    'extension.connect.permission.chains': 'Use only the networks you select below',
    'extension.connect.permission.signing':
        'Ask separately before signing any message or transaction',
    'extension.connect.permission.remember':
        'Remember a later signing approval only if you choose. Revoke it anytime in Connected sites.',
    'extension.connect.chains': 'Networks',
    'extension.connect.chains.requestedHint':
        'Choose from the networks this site requested. You can change this later.',
    'extension.connect.chains.hint':
        'Pick which networks this site can see. You can change this later.',
    'extension.connect.chains.allow': 'Allow {chain} {network}',
    'extension.connect.accounts.hint': 'Pick which accounts this site can see.',
    'extension.connect.accounts.share': 'Share {name}',
    'extension.connect.accounts.primary':
        'This site can see your primary account.',

    'extension.sign.source': 'Source',
    'extension.sign.declaredName': 'Site-provided name: {name}',
    'extension.sign.signInAs': 'Sign in as',
    'extension.sign.noSignInAddress': 'This site has no address it may sign in with.',
    'extension.sign.checkingWalletMode': 'Checking wallet mode…',
    'extension.sign.passwordHint': 'Required to sign. Your password stays in this window.',
    'extension.sign.feeSetBySite': 'Set by the site{rate}',
    'extension.sign.alwaysAllow':
        'Always allow this site. You can revoke this in Connected sites.',
    'extension.sign.warningNoun.message': 'message',
    'extension.sign.signingPaths': 'Signing paths',
    'extension.sign.action.reading': 'Reading this action…',
    'extension.sign.action.unavailable':
        "This action couldn't be described. Approve only if you know exactly what it does.",
    'extension.sign.signInTo': 'Sign in to',
    'extension.sign.warningNoun.signIn': 'sign-in',
    'extension.sign.oneTimeCode': 'One-time code',
    'extension.sign.controlCharacters':
        'Control characters are displayed safely. The original {noun} text is what you will sign.',
    'extension.sign.coSignRequest': 'Co-sign request',
    'extension.sign.decodingRequest': 'Decoding request…',
    'extension.sign.trustSource': 'Only approve it if you trust the source.',
    'extension.sign.agentAccount': 'Agent account',
    'extension.sign.coSignerAccount': 'Co-signer account',
    'extension.sign.policyRefusal': 'The co-signer will refuse it even if you approve.',
    'extension.sign.confirmThreshold':
        'Above the policy confirm-threshold: review carefully before approving.',

    // Copy moved out of JSX literals by the i18n sweep.
    'extension.connection.unableToReconnect': 'Unable to reconnect',
    'extension.connection.reconnectingToWallet': 'Reconnecting to wallet…',
    'extension.connection.theWalletBackgroundIsNot':
        "The wallet background isn't responding. Reload the popup to try again.",
    'extension.connection.theWalletBackgroundIsRestarting':
        'The wallet background is restarting. This should only take a moment.',
    'extension.connection.reload': 'Reload',
};

addEnglish(messages);

export default messages;
