// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { addEnglish } from '../../store.js';

const messages = {
    'pwaInstall.installApp': 'Install App',
    'pwaInstall.addToHomeScreen': 'Add to Home Screen',
    'pwaInstall.addToHomeScreenSummary': 'Install this wallet on this device',
    'pwaInstall.manualStepsSummary': 'Follow your browser\'s install steps',
    'pwaInstall.iosTitle': 'Add XChain Wallet to your Home Screen',
    'pwaInstall.iosSafariSteps': 'Tap Share, then Add to Home Screen.',
    'pwaInstall.iosChromeSteps': 'Tap Share in the address bar, then Add to Home Screen.',
    'pwaInstall.otherBrowserSteps': 'Open your browser menu, then choose Install App or Add to Home Screen.',
    'pwaInstall.dismissIosHint': 'Dismiss install instructions.',
};

addEnglish(messages);

export default messages;
