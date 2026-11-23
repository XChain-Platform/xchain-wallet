/*
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.activity;

import java.io.File;
import java.io.IOException;
import java.util.List;

final class ActivityCheckStore {

    static final String WORK_NAME = "xc_activity_check";

    private final ActivityCheckFiles files;
    private final Runnable cancelPeriodicWork;

    ActivityCheckStore(File appFiles, Runnable cancelPeriodicWork) {
        files = new ActivityCheckFiles(appFiles);
        this.cancelPeriodicWork = cancelPeriodicWork;
    }

    void setActivityCheck(String json) throws IOException {
        files.writeConfig(json);
    }

    List<Long> runLog() throws IOException {
        return files.runLog();
    }

    boolean clear() {
        cancelPeriodicWork.run();
        return files.clear();
    }
}
