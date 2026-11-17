// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The list action routes as the shells open them: each renders the one List
// form (ListCreateForm.jsx) with its action picked, exactly the way the web,
// desktop and extension App.jsx route blocks do. The behaviour tests that
// once mounted the separate rename, share, transfer and fork forms mount
// these, so every case runs against the merged form.

import { ListCreateForm } from '../../packages/core/src/shared/routes/ListCreateForm.jsx';

/** list-rename: the List form on Edit (the name and description live there). */
export function ListEditRoute(props) {
    return <ListCreateForm {...props} action="edit" />;
}

/** list-share: the List form on Share. */
export function ListShareRoute(props) {
    return <ListCreateForm {...props} action="share" />;
}

/** list-transfer: the List form on Transfer. */
export function ListTransferRoute(props) {
    return <ListCreateForm {...props} action="transfer" />;
}

/** list-fork: the List form on Fork. */
export function ListForkRoute(props) {
    return <ListCreateForm {...props} action="fork" />;
}
