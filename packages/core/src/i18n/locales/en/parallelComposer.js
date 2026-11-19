// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `parallelComposer.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'parallelComposer.title': 'Action Queue',
    'parallelComposer.summary':
        '{actions, plural, one {# action} other {# actions}} across {networks, plural, one {# network} other {# networks}}',
    'parallelComposer.noRollback':
        "Actions on different networks aren't settled as one unit; only an individual swap completes together.",
    'parallelComposer.confirmNotice':
        'Each action in the queue signs and broadcasts on its own: if a later action fails, the actions already sent stay sent.',
    'parallelComposer.statusPrefix': 'Status',
    'parallelComposer.rowStatusPrefix': 'Row {row} status',
    'parallelComposer.rowEmpty': 'No action yet',
    'parallelComposer.fileLabel': 'File contents',
    'parallelComposer.fileHelp': 'Choose the file whose bytes this FILE action publishes.',
    'parallelComposer.fileHint': 'A non-empty file is required before Review or signing.',
    'parallelComposer.fileLoading': 'Loading {name}…',
    'parallelComposer.fileSelected': 'Selected: {name}',
    'parallelComposer.fileFallbackName': 'file',
    'parallelComposer.fileRequired': 'choose a non-empty file to publish.',
    'parallelComposer.fileEmpty': 'the selected file is empty. Choose a non-empty file.',
    'parallelComposer.fileUnreadable': 'the wallet was unable to read the selected file. Choose it again or use another file.',
    'parallelComposer.fileReading': 'wait for the selected file to finish loading.',
};

addEnglish(messages);

export default messages;
