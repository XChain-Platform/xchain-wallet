/*
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.links;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class BrowserReturnIntentTest {

    private static final String BROWSER_PACKAGE = "com.android.chrome";
    private static final String OWN_PACKAGE = "io.xchain.wallet.android";
    private static final String URL = "https://example.com/callback?code=AbC%2F123#done";

    private PackageManager packageManager;

    @Before
    public void setUp() {
        packageManager = RuntimeEnvironment.getApplication().getPackageManager();
        Intent genericHttps = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"))
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage(BROWSER_PACKAGE);
        ResolveInfo browser = new ResolveInfo();
        browser.activityInfo = new ActivityInfo();
        browser.activityInfo.packageName = BROWSER_PACKAGE;
        browser.activityInfo.name = BROWSER_PACKAGE + ".Main";
        Shadows.shadowOf(packageManager).addResolveInfoForIntent(genericHttps, browser);
    }

    @Test
    public void targetsResolvingAndroidAppReferrer() {
        Intent intent = BrowserReturnIntent.forUrl(
                URL, "android-app://" + BROWSER_PACKAGE, OWN_PACKAGE, packageManager);

        assertNotNull(intent);
        assertEquals(Intent.ACTION_VIEW, intent.getAction());
        assertEquals(BROWSER_PACKAGE, intent.getPackage());
        assertEquals(URL, intent.getDataString());
        assertTrue(intent.hasCategory(Intent.CATEGORY_BROWSABLE));
        assertTrue((intent.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) != 0);
    }

    @Test
    public void leavesPackageUnsetForUntrustedReferrers() {
        assertNull(intentFor("android-app://unregistered.browser").getPackage());
        assertNull(intentFor("android-app://" + OWN_PACKAGE).getPackage());
        assertNull(intentFor("https://example.com/").getPackage());
        assertNull(intentFor(null).getPackage());
    }

    @Test
    public void rejectsMissingCheckedUrl() {
        assertNull(BrowserReturnIntent.forUrl(null, null, OWN_PACKAGE, packageManager));
        assertNull(BrowserReturnIntent.forUrl("", null, OWN_PACKAGE, packageManager));
    }

    @Test
    public void rejectsMissingResolutionInputs() {
        assertFalse(BrowserReturnIntent.resolvesGenericHttps(null, BROWSER_PACKAGE));
        assertFalse(BrowserReturnIntent.resolvesGenericHttps(packageManager, ""));
    }

    private Intent intentFor(String referrerUri) {
        Intent intent = BrowserReturnIntent.forUrl(URL, referrerUri, OWN_PACKAGE, packageManager);
        assertNotNull(intent);
        assertEquals(URL, intent.getDataString());
        assertTrue(intent.hasCategory(Intent.CATEGORY_BROWSABLE));
        assertTrue((intent.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) != 0);
        return intent;
    }
}
