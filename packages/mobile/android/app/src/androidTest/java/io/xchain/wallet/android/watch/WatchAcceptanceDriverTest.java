// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import io.xchain.wallet.android.notify.NotifyActionRules;
import io.xchain.wallet.android.notify.XChainNotifyPlugin;

@RunWith(AndroidJUnit4.class)
public final class WatchAcceptanceDriverTest {

    @Test
    public void balances() throws Exception {
        XChainWatchPlugin plugin = watchPlugin();
        assertTrue(plugin.sendSnapshotJson(fixture("snapshot-rows50.json")));
        settle();
        assertTrue(plugin.sendDetailJson(fixture("detail-native.json")));
        settle();
        assertTrue(plugin.sendDetailJson(fixture("detail-cached.json")));
        settle();

        byte[] image = WatchRisk8Payload.png(400);
        assertNotNull(image);
        assertTrue(plugin.sendImageData(
                WatchRisk8Payload.sha256Hex(image),
                Base64.getEncoder().encodeToString(image)));
        settle();
    }

    @Test
    public void alerts() throws Exception {
        Context context = targetContext();
        grantNotificationPermission(context);

        XChainWatchPlugin watch = watchPlugin();
        JSONObject request = new JSONObject(fixture("request-paydue.json"));
        JSONObject snapshot = new JSONObject(fixture("snapshot-empty.json"));
        JSONArray inbox = new JSONArray().put(new JSONObject()
                .put("id", "watch-acceptance-alert")
                .put("family", "priceAlerts")
                .put("kind", "price-alert")
                .put("title", "Watch acceptance alert")
                .put("body", "The Android notification path reached the watch.")
                .put("at", System.currentTimeMillis())
                .put("read", false));
        snapshot.put("builtAt", System.currentTimeMillis());
        snapshot.put("inbox", inbox);
        snapshot.put("request", request);
        assertTrue(watch.sendSnapshotJson(snapshot.toString()));
        settle();

        File config = new File(context.getFilesDir(), "activity-check.json");
        boolean hadConfig = config.isFile();
        byte[] previousConfig = hadConfig ? read(config) : null;
        write(config, "{\"openOnPhoneTitle\":\"Open on phone\"}"
                .getBytes(StandardCharsets.UTF_8));
        try {
            TestNotifyPlugin notify = new TestNotifyPlugin(context);
            assertPosted(notify, new JSObject()
                    .put("id", "watch-acceptance-alert")
                    .put("title", "Watch acceptance alert")
                    .put("body", "XChain watch notification test")
                    .put("family", "priceAlerts")
                    .put("category", "alert")
                    .put("threadId", "watch-acceptance"));

            JSArray actions = new JSArray();
            actions.put(new JSObject().put("id", NotifyActionRules.ACTION_OPEN_ON_PHONE));
            assertPosted(notify, new JSObject()
                    .put("id", request.getString("id"))
                    .put("title", "Payment due")
                    .put("body", request.getString("sentence"))
                    .put("family", "deadlines")
                    .put("category", "paydue")
                    .put("threadId", "watch-acceptance")
                    .put("actions", actions));
        } finally {
            if (hadConfig) write(config, previousConfig);
            else assertTrue(!config.exists() || config.delete());
        }
    }

    @Test
    public void privacy() throws Exception {
        XChainWatchPlugin plugin = watchPlugin();
        assertTrue(plugin.sendSnapshotJson(fixture("snapshot-hidden.json")));
        settle();
        assertTrue(plugin.sendSnapshotJson(fixture("snapshot-disabled.json")));
        settle();
    }

    private static XChainWatchPlugin watchPlugin() {
        return new XChainWatchPlugin(targetContext());
    }

    private static Context targetContext() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    private static void settle() throws InterruptedException {
        Thread.sleep(1_000L);
    }

    private static String fixture(String name) throws IOException {
        try (InputStream input = InstrumentationRegistry.getInstrumentation()
                .getContext().getAssets().open(name)) {
            return new String(read(input), StandardCharsets.UTF_8);
        }
    }

    private static byte[] read(File file) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            return read(input);
        }
    }

    private static byte[] read(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private static void write(File file, byte[] bytes) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
        }
    }

    private static void grantNotificationPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .grantRuntimePermission(
                        context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
    }

    private static void assertPosted(TestNotifyPlugin plugin, JSObject values) {
        TestCall call = new TestCall(values);
        plugin.post(call);
        assertNull(call.rejection);
        assertNotNull(call.result);
        assertTrue(call.result.optBoolean("posted"));
    }

    private static final class TestNotifyPlugin extends XChainNotifyPlugin {
        private final Context context;

        TestNotifyPlugin(Context context) {
            this.context = context;
        }

        @Override
        public Context getContext() {
            return context;
        }
    }

    private static final class TestCall extends PluginCall {
        JSObject result;
        String rejection;

        TestCall(JSObject data) {
            super(null, "XChainNotify", "acceptance", "post", data);
        }

        @Override
        public void resolve(JSObject data) {
            result = data;
        }

        @Override
        public void reject(String message, Exception error) {
            rejection = message;
        }
    }
}
