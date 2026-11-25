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
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class XChainLinksPluginReturnTest {

    private static final String BROWSER_PACKAGE = "com.android.chrome";
    private static final String URL = "https://example.com/done#xchain=AA";

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
    public void declaresReturnToBrowser() throws Exception {
        Method method = XChainLinksPlugin.class.getDeclaredMethod(
                "returnToBrowser", PluginCall.class);
        assertNotNull(method.getAnnotation(PluginMethod.class));
    }

    @Test
    public void opensExactUrlInRegisteredReferrerBrowser() {
        TestPlugin plugin = new TestPlugin();
        plugin.linkReferrer = "android-app://" + BROWSER_PACKAGE;
        List<Intent> opened = new ArrayList<>();
        plugin.returnOpener = opened::add;
        TestCall call = callFor(URL);

        plugin.returnToBrowser(call);

        assertNull(call.rejection);
        assertNotNull(call.result);
        assertEquals(0, call.result.length());
        assertEquals(1, opened.size());
        assertEquals(Intent.ACTION_VIEW, opened.get(0).getAction());
        assertEquals(URL, opened.get(0).getDataString());
        assertEquals(BROWSER_PACKAGE, opened.get(0).getPackage());
    }

    @Test
    public void opensExactUrlInDefaultBrowserWithoutReferrer() {
        TestPlugin plugin = new TestPlugin();
        List<Intent> opened = new ArrayList<>();
        plugin.returnOpener = opened::add;
        TestCall call = callFor(URL);

        plugin.returnToBrowser(call);

        assertNull(call.rejection);
        assertNotNull(call.result);
        assertEquals(1, opened.size());
        assertEquals(Intent.ACTION_VIEW, opened.get(0).getAction());
        assertEquals(URL, opened.get(0).getDataString());
        assertNull(opened.get(0).getPackage());
    }

    @Test
    public void refusesInvalidReturnUrlsWithoutOpening() {
        TestPlugin plugin = new TestPlugin();
        List<Intent> opened = new ArrayList<>();
        plugin.returnOpener = opened::add;

        TestCall http = callFor("http://example.com/");
        plugin.returnToBrowser(http);
        assertEquals("Return URL refused", http.rejection);
        assertNull(http.result);

        TestCall newline = callFor("https://example.com/done\nforged");
        plugin.returnToBrowser(newline);
        assertEquals("Return URL refused", newline.rejection);
        assertNull(newline.result);
        assertEquals(0, opened.size());
    }

    @Test
    public void hidesBrowserOpenFailure() {
        TestPlugin plugin = new TestPlugin();
        plugin.returnOpener = intent -> {
            throw new ActivityNotFoundException(intent.getDataString());
        };
        TestCall call = callFor(URL);

        plugin.returnToBrowser(call);

        assertNull(call.result);
        assertEquals("No browser opened the return URL", call.rejection);
    }

    @Test
    public void choosesIntentReferrersBeforeActivityReferrer() {
        Uri activityReferrer = Uri.parse("android-app://activity.browser");
        Intent uriIntent = new Intent()
                .putExtra(Intent.EXTRA_REFERRER_NAME, "android-app://named.browser")
                .putExtra(Intent.EXTRA_REFERRER, Uri.parse("android-app://uri.browser"));
        assertEquals("android-app://uri.browser",
                XChainLinksPlugin.referrerOf(uriIntent, activityReferrer));

        Intent namedIntent = new Intent()
                .putExtra(Intent.EXTRA_REFERRER_NAME, "android-app://named.browser");
        assertEquals("android-app://named.browser",
                XChainLinksPlugin.referrerOf(namedIntent, activityReferrer));

        assertEquals("android-app://activity.browser",
                XChainLinksPlugin.referrerOf(new Intent(), activityReferrer));
        assertNull(XChainLinksPlugin.referrerOf(new Intent(), null));
    }

    private static TestCall callFor(String url) {
        return new TestCall(new JSObject().put("url", url));
    }

    private static final class TestPlugin extends XChainLinksPlugin {
        @Override
        Context returnContext() {
            return RuntimeEnvironment.getApplication();
        }
    }

    private static final class TestCall extends PluginCall {
        JSObject result;
        String rejection;

        TestCall(JSObject data) {
            super(null, "XChainLinks", "test", "returnToBrowser", data);
        }

        @Override
        public void resolve(JSObject data) {
            result = data;
        }

        @Override
        public void reject(String message) {
            rejection = message;
        }
    }
}
