// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `desktopUpdate.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- desktop update banner ----------------------------------
    'desktopUpdate.checking': 'Checking for updates…',
    'desktopUpdate.current': 'XChain Wallet is up to date.',
    'desktopUpdate.availableVersion': 'Version {version} is available.',
    'desktopUpdate.available': 'A newer version is available.',
    'desktopUpdate.downloading': 'Downloading update…',
    'desktopUpdate.downloadProgress': 'Downloading update… {progress}%',
    'desktopUpdate.verifying': 'Verifying the downloaded update…',
    'desktopUpdate.ready': 'Update is ready to restart.',
    'desktopUpdate.restartBlocked': 'Finish the current wallet operation before restarting.',
    'desktopUpdate.checkError': "Couldn't check for updates. Check your connection and try again.",
    'desktopUpdate.installError':
        "This update couldn't be downloaded or verified, so it wasn't installed. "
        + 'Your wallet is untouched. See docs.xchain.io for steps to verify a release.',
    'desktopUpdate.download': 'Download update',
    'desktopUpdate.restart': 'Restart to update',
    'desktopUpdate.retry': 'Retry',
    'desktopUpdate.dismissLabel': 'Dismiss update notice',
    'desktopUpdate.dismiss': 'Dismiss',
};

addEnglish(messages);

export default messages;
