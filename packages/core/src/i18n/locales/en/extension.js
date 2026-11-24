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
    'extension.approval.loadFailed':
        "We couldn't load this request. Close this window and try again from the site.",
    'extension.approval.unsupported': 'Unsupported approval request type.',
    'extension.popup.checkingPage': 'Checking page availability…',
    'extension.popup.unsupportedPage': "XChain Wallet can't connect to this page.",
    'extension.popup.unsupportedPageHint': 'Open a regular website to use the wallet.',
    'extension.approval.reject': 'Reject',
    'extension.approval.requestingSite': 'Requesting site',
    'extension.approval.linkAnswer': 'Opened from a link. The answer goes to {origin}',
    'extension.approval.invalidLinkTargets':
        "This request names different sites and can't be approved.",

    'extension.approval.title': 'Approval Request',
    'extension.connect.title': 'Connect Wallet',
    'extension.connect.approve': 'Approve',
    'extension.connect.aboutField': 'About {label}',
    'extension.connect.allowCoin': 'Allow {coin}',
    'extension.connect.chains': 'Networks',
    'extension.connect.accounts.share': 'Share {name}',

    'extension.sign.declaredName': 'Site-provided name: {name}',
    'extension.sign.loginTitle': 'Login with XChain',
    'extension.sign.signInAs': 'Log in as',
    'extension.sign.signInAsHint': 'Select the approved address this site will use to sign in.',
    'extension.sign.noSignInAddress': 'This site has no address it may log in with.',
    'extension.sign.providerSignInAs': 'Sign in as',
    'extension.sign.providerNoSignInAddress': 'This site has no address it may sign in with.',
    'extension.sign.passwordHint': 'Required to sign. Your password stays in this window.',
    'extension.sign.feeSetBySite': 'Set by the site{rate}',
    'extension.sign.alwaysAllow':
        'Always allow this site. You can revoke this in Connected sites.',
    'extension.sign.warningNoun.message': 'message',
    'extension.sign.signingPaths': 'Signing paths',
    'extension.sign.psbtMissing': 'This request is missing the transaction to sign',
    'extension.sign.signInTo': 'Log in to',
    'extension.sign.warningNoun.signIn': 'sign-in',
    'extension.sign.anotherDevice': 'You are logging in on another device at {origin}',
    'extension.sign.oneTimeCode': 'One-time code',
    'extension.sign.controlCharacters':
        'Control characters are displayed safely. The original {noun} text is what you will sign.',
    'extension.sign.trustSource': 'Only approve it if you trust the source.',
    'extension.sign.agentAccount': 'Agent account',
    'extension.sign.coSignerAccount': 'Cosigner account',
    'extension.sign.policyRefusal': 'The cosigner will refuse it even if you approve.',
    'extension.sign.confirmThreshold':
        'Above the policy confirm-threshold: review carefully before approving.',
    'extension.sign.clockWarning':
        'The clock on this device moved in an unexpected way, which can skew the spending window. Check the date and time before approving.',

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
