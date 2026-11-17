// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `onboarding.*` keys, loaded at startup by i18n/index.js.

import { addEnglish } from '../../store.js';

const messages = {
    'onboarding.carousel.getStarted': 'Get Started',
    'onboarding.demo.walletExists': 'This device already has a wallet. Unlock it to continue.',
    'onboarding.demo.unlock': 'Unlock',
    'onboarding.carousel.skip': 'Skip',
    'onboarding.carousel.steps': 'Onboarding steps',
    'onboarding.carousel.stepLabel': 'Step {current} of {count}: {title}',
    'onboarding.carousel.next': 'Next',

    // Copy moved out of JSX literals by the i18n sweep.
    'onboarding.backToWallets': 'Back to wallets',
    'onboarding.leaveTheDemo': 'Leave the demo',
    'onboarding.licenseAgreement': 'License Agreement',
    'onboarding.acceptAndContinue': 'Accept and Continue',
    'onboarding.licenseTerms': 'License terms',
    'onboarding.iHaveReadAndAgree': 'I have read and agree to these terms.',
    'onboarding.scrollToTheEndTo': 'Scroll to the end to review all terms.',
    'onboarding.licenseAckHelp': 'The terms for using this wallet app. The box turns on once you reach the end of the terms, and ticking it lets you continue to wallet setup.',
    'onboarding.leaveTheDemoFirst': 'Leave the Demo First',
    'onboarding.clearDemoCreateNewWallet': 'Clear Demo & Create New Wallet',
    'onboarding.clearDemoImportWallet': 'Clear Demo & Import Wallet',
    'onboarding.keepExploringTheDemo': 'Keep Exploring the Demo',
    'onboarding.theDemoUsesATemporary': 'The demo uses a temporary password for this device.',
    'onboarding.clearTheDemoBeforeYou':
        'Clear the demo before you create or import a wallet. Your wallet can then use the password you choose.',
    'onboarding.demoBalancesAndActivityAre':
        "Demo balances and activity are examples, so clearing the demo doesn't affect real funds.",
    'onboarding.walletSetup': 'Wallet Setup',
    'onboarding.welcomeTagline': 'Multi-chain wallet for the XChain platform.',
    'onboarding.createNewWallet': 'Create New Wallet',
    'onboarding.connectHardwareWallet': 'Connect Hardware Wallet',
    'onboarding.settingUpDemo': 'Setting Up Demo…',
    'onboarding.tryInDemoMode': 'Try Demo',
};

addEnglish(messages);

export default messages;
