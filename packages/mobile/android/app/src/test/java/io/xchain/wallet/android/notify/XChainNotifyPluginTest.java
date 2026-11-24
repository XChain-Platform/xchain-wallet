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

package io.xchain.wallet.android.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;

import androidx.work.Configuration;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.testing.SynchronousExecutor;
import androidx.work.testing.TestDriver;
import androidx.work.testing.WorkManagerTestInitHelper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowNotificationManager;
import org.robolectric.shadows.ShadowPendingIntent;

import java.io.File;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import io.xchain.wallet.android.MainActivity;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class XChainNotifyPluginTest {

    @Test
    public void declaresEveryMethodAndPostNotificationsPermission() {
        Set<String> methods = new HashSet<>();
        for (Method method : XChainNotifyPlugin.class.getDeclaredMethods()) {
            if (method.isAnnotationPresent(PluginMethod.class)) methods.add(method.getName());
        }
        assertTrue(methods.containsAll(Arrays.asList(
                "post", "cancel", "cancelAll", "schedule",
                "permissionState", "requestPermission")));

        CapacitorPlugin plugin = XChainNotifyPlugin.class.getAnnotation(CapacitorPlugin.class);
        assertNotNull(plugin);
        assertEquals("XChainNotify", plugin.name());
        assertEquals(1, plugin.permissions().length);
        assertEquals(XChainNotifyPlugin.NOTIFICATION_PERMISSION,
                plugin.permissions()[0].alias());
        assertEquals(Manifest.permission.POST_NOTIFICATIONS,
                plugin.permissions()[0].strings()[0]);
    }

    @Test
    public void createsOneChannelForEachNotificationFamily() {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);

        XChainNotifyPlugin.createChannels(context);

        assertEquals(NotifyChannels.FAMILIES.size(), manager.getNotificationChannels().size());
        for (String family : NotifyChannels.FAMILIES) {
            NotificationChannel channel = manager.getNotificationChannel(
                    NotifyChannels.channelId(family));
            assertNotNull(channel);
            assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel.getImportance());
        }
    }

    @Test
    public void postsOnFamilyChannelAndLeavesWearBridgeEnabled() {
        Context context = RuntimeEnvironment.getApplication();
        XChainNotifyPlugin.NotificationSpec spec = new XChainNotifyPlugin.NotificationSpec(
                "receipt-7", "Received", "12 XCP arrived.", "incomingReceipts",
                "alert", "account-2", false, 0L);

        Notification notification = XChainNotifyPlugin.post(context, spec);

        ShadowNotificationManager manager = shadowOf(
                context.getSystemService(NotificationManager.class));
        assertNotNull(manager.getNotification("receipt-7".hashCode()));
        assertEquals("xc_notify_incomingReceipts", notification.getChannelId());
        assertEquals("Received", notification.extras.getString(Notification.EXTRA_TITLE));
        assertEquals("12 XCP arrived.", notification.extras.getString(Notification.EXTRA_TEXT));
        assertEquals("account-2", notification.getGroup());
        assertFalse((notification.flags & Notification.FLAG_LOCAL_ONLY) != 0);
    }

    @Test
    public void rejectsUnknownFamiliesBeforePosting() {
        try {
            new XChainNotifyPlugin.NotificationSpec(
                    "alert-1", "Alert", null, "request", "alert", null, false, 0L);
            fail("unknown family accepted");
        } catch (IllegalArgumentException expected) {
            assertEquals("Unknown notification family", expected.getMessage());
        }
    }

    @Test
    public void convertsOpenOnPhoneIntentToOneActionEvent() {
        Intent intent = new Intent()
                .putExtra(NotifyActionRules.EXTRA_ACTION,
                        NotifyActionRules.ACTION_OPEN_ON_PHONE)
                .putExtra(NotifyActionRules.EXTRA_CATEGORY, "request")
                .putExtra(NotifyActionRules.EXTRA_ID, "request-9");

        JSObject payload = XChainNotifyPlugin.actionPayload(intent);

        assertNotNull(payload);
        assertEquals("openOnPhone", payload.optString("action"));
        assertEquals("request", payload.optString("category"));
        assertEquals("request-9", payload.optString("id"));
        assertNull(XChainNotifyPlugin.actionPayload(intent));
        assertNull(XChainNotifyPlugin.actionPayload(new Intent()
                .putExtra(NotifyActionRules.EXTRA_ACTION, "dismiss")
                .putExtra(NotifyActionRules.EXTRA_CATEGORY, "request")
                .putExtra(NotifyActionRules.EXTRA_ID, "request-9")));
    }

    @Test
    public void productionScheduleRunsScheduledNotifyWorker() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        WorkManager workManager = initializeWorkManager(context);
        XChainNotifyPlugin.createChannels(context);
        TestPlugin plugin = new TestPlugin(context);
        TestCall call = new TestCall("schedule", notificationData("deadline-4")
                .put("body", "Due soon")
                .put("at", System.currentTimeMillis() + 60_000L));

        plugin.schedule(call);

        assertNull(call.rejection);
        assertTrue(call.result.optBoolean("scheduled"));
        WorkInfo scheduled = onlyWork(workManager, "deadline-4");
        assertEquals(WorkInfo.State.ENQUEUED, scheduled.getState());
        assertTrue(scheduled.getTags().contains(ScheduledNotify.TAG));

        TestDriver driver = WorkManagerTestInitHelper.getTestDriver(context);
        assertNotNull(driver);
        driver.setInitialDelayMet(scheduled.getId());
        assertEquals(WorkInfo.State.SUCCEEDED,
                workManager.getWorkInfoById(scheduled.getId()).get().getState());
        Notification posted = shadowOf(context.getSystemService(NotificationManager.class))
                .getNotification("deadline-4".hashCode());
        assertNotNull(posted);
        assertEquals("xc_notify_deadlines", posted.getChannelId());
        assertEquals("Payment due", posted.extras.getString(Notification.EXTRA_TITLE));
        assertEquals("Due soon", posted.extras.getString(Notification.EXTRA_TEXT));
        assertFalse((posted.flags & Notification.FLAG_LOCAL_ONLY) != 0);
    }

    @Test
    public void productionCancelRemovesPostedNotificationAndScheduledWork() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        WorkManager workManager = initializeWorkManager(context);
        TestPlugin plugin = new TestPlugin(context);
        XChainNotifyPlugin.NotificationSpec spec = new XChainNotifyPlugin.NotificationSpec(
                "deadline-5", "Payment due", null, "deadlines",
                "alert", null, false, 0L);
        XChainNotifyPlugin.post(context, spec);
        TestCall schedule = new TestCall("schedule", notificationData("deadline-5")
                .put("at", System.currentTimeMillis() + 60_000L));
        plugin.schedule(schedule);
        assertNull(schedule.rejection);
        assertTrue(schedule.result.optBoolean("scheduled"));
        WorkInfo scheduled = onlyWork(workManager, "deadline-5");
        ShadowNotificationManager manager = shadowOf(
                context.getSystemService(NotificationManager.class));
        assertNotNull(manager.getNotification("deadline-5".hashCode()));
        TestCall call = new TestCall("cancel", new JSObject().put("id", "deadline-5"));

        plugin.cancel(call);

        assertNull(call.rejection);
        assertNull(manager.getNotification("deadline-5".hashCode()));
        assertEquals(WorkInfo.State.CANCELLED,
                workManager.getWorkInfoById(scheduled.getId()).get().getState());
        assertTrue(call.result.optBoolean("cancelled"));
    }

    @Test
    public void productionCancelAllRemovesEveryNotificationAndScheduledWork() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        WorkManager workManager = initializeWorkManager(context);
        TestPlugin plugin = new TestPlugin(context);
        XChainNotifyPlugin.post(context, new XChainNotifyPlugin.NotificationSpec(
                "alert-6", "First", null, "priceAlerts", "alert", null, false, 0L));
        XChainNotifyPlugin.post(context, new XChainNotifyPlugin.NotificationSpec(
                "alert-7", "Second", null, "priceAlerts", "alert", null, false, 0L));
        long later = System.currentTimeMillis() + 60_000L;
        TestCall firstSchedule = new TestCall(
                "schedule", notificationData("alert-6").put("at", later));
        TestCall secondSchedule = new TestCall(
                "schedule", notificationData("alert-7").put("at", later));
        plugin.schedule(firstSchedule);
        plugin.schedule(secondSchedule);
        assertNull(firstSchedule.rejection);
        assertNull(secondSchedule.rejection);
        assertTrue(firstSchedule.result.optBoolean("scheduled"));
        assertTrue(secondSchedule.result.optBoolean("scheduled"));
        WorkInfo first = onlyWork(workManager, "alert-6");
        WorkInfo second = onlyWork(workManager, "alert-7");
        ShadowNotificationManager manager = shadowOf(
                context.getSystemService(NotificationManager.class));
        TestCall call = new TestCall("cancelAll", new JSObject());

        plugin.cancelAll(call);

        assertEquals(0, manager.size());
        assertEquals(WorkInfo.State.CANCELLED,
                workManager.getWorkInfoById(first.getId()).get().getState());
        assertEquals(WorkInfo.State.CANCELLED,
                workManager.getWorkInfoById(second.getId()).get().getState());
        assertTrue(call.resolvedWithoutData);
    }

    @Test
    public void productionPostBuildsRealNotifyActionsPendingIntent() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        File config = new File(context.getFilesDir(), "activity-check.json");
        Files.write(config.toPath(),
                "{\"openOnPhoneTitle\":\"Open on phone\"}"
                        .getBytes(StandardCharsets.UTF_8));
        try {
            TestPlugin plugin = new TestPlugin(context);
            JSArray actions = new JSArray();
            actions.put(new JSObject().put("id", NotifyActionRules.ACTION_OPEN_ON_PHONE));
            TestCall call = new TestCall("post", notificationData("request-8")
                    .put("category", "request")
                    .put("actions", actions));

            plugin.post(call);

            assertNull(call.rejection);
            Notification notification = shadowOf(
                    context.getSystemService(NotificationManager.class))
                    .getNotification("request-8".hashCode());
            assertNotNull(notification);
            assertEquals(1, notification.actions.length);
            assertEquals("Open on phone", notification.actions[0].title);
            assertEquals(notification.actions[0].actionIntent, notification.contentIntent);
            ShadowPendingIntent pending = shadowOf(notification.actions[0].actionIntent);
            assertTrue(pending.isActivity());
            assertTrue(pending.isImmutable());
            Intent intent = pending.getSavedIntent();
            assertEquals(MainActivity.class.getName(), intent.getComponent().getClassName());
            assertEquals(NotifyActionRules.ACTION_OPEN_ON_PHONE,
                    intent.getStringExtra(NotifyActionRules.EXTRA_ACTION));
            assertEquals("request",
                    intent.getStringExtra(NotifyActionRules.EXTRA_CATEGORY));
            assertEquals("request-8", intent.getStringExtra(NotifyActionRules.EXTRA_ID));
            assertTrue(call.result.optBoolean("posted"));
        } finally {
            Files.deleteIfExists(config.toPath());
        }
    }

    @Test
    public void requestsPostNotificationsAtRuntimeWhenPrompted() {
        Context context = RuntimeEnvironment.getApplication();
        TestPlugin plugin = new TestPlugin(context);
        plugin.permissionState = PermissionState.PROMPT;
        TestCall prompted = new TestCall("requestPermission", new JSObject());

        plugin.requestPermission(prompted);

        assertEquals(XChainNotifyPlugin.NOTIFICATION_PERMISSION, plugin.requestedAlias);
        assertEquals("notificationPermissionCallback", plugin.permissionCallback);
        assertEquals(prompted, plugin.permissionCall);
        assertNull(prompted.result);

        plugin.permissionState = PermissionState.GRANTED;
        plugin.requestedAlias = null;
        TestCall granted = new TestCall("requestPermission", new JSObject());
        plugin.requestPermission(granted);

        assertNull(plugin.requestedAlias);
        assertEquals(PermissionState.GRANTED.toString(), granted.result.optString("state"));
    }

    private static JSObject notificationData(String id) {
        return new JSObject()
                .put("id", id)
                .put("title", "Payment due")
                .put("family", "deadlines");
    }

    private static WorkManager initializeWorkManager(Context context) {
        Configuration configuration = new Configuration.Builder()
                .setExecutor(new SynchronousExecutor())
                .build();
        WorkManagerTestInitHelper.initializeTestWorkManager(context, configuration);
        return WorkManager.getInstance(context);
    }

    private static WorkInfo onlyWork(WorkManager manager, String id) throws Exception {
        List<WorkInfo> work = manager.getWorkInfosForUniqueWork(
                ScheduledNotify.uniqueWorkName(id)).get();
        assertEquals(1, work.size());
        return work.get(0);
    }

    private static final class TestPlugin extends XChainNotifyPlugin {
        private final Context context;
        PermissionState permissionState = PermissionState.PROMPT;
        String requestedAlias;
        PluginCall permissionCall;
        String permissionCallback;

        TestPlugin(Context context) {
            this.context = context;
        }

        @Override
        public Context getContext() {
            return context;
        }

        @Override
        public PermissionState getPermissionState(String alias) {
            assertEquals(NOTIFICATION_PERMISSION, alias);
            return permissionState;
        }

        @Override
        protected void requestPermissionForAlias(
                String alias, PluginCall call, String callbackName) {
            requestedAlias = alias;
            permissionCall = call;
            permissionCallback = callbackName;
        }
    }

    private static final class TestCall extends PluginCall {
        JSObject result;
        boolean resolvedWithoutData;
        String rejection;

        TestCall(String method, JSObject data) {
            super(null, "XChainNotify", "test", method, data);
        }

        @Override
        public void resolve(JSObject data) {
            result = data;
        }

        @Override
        public void resolve() {
            resolvedWithoutData = true;
        }

        @Override
        public void reject(String message, Exception error) {
            rejection = message;
        }
    }
}
