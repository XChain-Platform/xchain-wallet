/*
 * Copyright © 2025–2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.watch;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@CapacitorPlugin(name = "XChainWatch")
public class XChainWatchPlugin extends Plugin implements WatchMessageRouter.Listener {

    interface LinkProbe {
        void status(Consumer<LinkState> result);
    }

    static final class LinkState {
        final boolean paired;
        final boolean installed;
        final boolean reachable;

        LinkState(boolean paired, boolean installed, boolean reachable) {
            this.paired = paired;
            this.installed = installed;
            this.reachable = reachable;
        }
    }

    private boolean available;
    private WearTransport transport;
    private LinkProbe linkProbe;
    private WatchMessageRouter router;
    private File imageDirectory;
    private byte[] lastSnapshot;
    private Long lastSyncAt;

    public XChainWatchPlugin() {}

    XChainWatchPlugin(boolean available, WearTransport transport, LinkProbe linkProbe, File cache) {
        this.available = available;
        this.transport = transport;
        this.linkProbe = linkProbe;
        this.imageDirectory = new File(cache, "xchain-watch-images");
    }

    XChainWatchPlugin(Context context) {
        initialize(context);
    }

    @Override
    public void load() {
        initialize(getContext());
    }

    private void initialize(Context context) {
        if (transport != null) return;
        available = WatchAvailability.watchAllowed(
                installerPackageName(context),
                (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        transport = new WearTransport(context);
        linkProbe = new GoogleLinkProbe(context);
        imageDirectory = new File(context.getCacheDir(), "xchain-watch-images");
        boolean playServicesReady = GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS;
        if (WatchAvailability.startsMessageRouter(
                installerPackageName(context),
                (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0,
                playServicesReady)) {
            router = new WatchMessageRouter(
                    Wearable.getMessageClient(context),
                    Wearable.getCapabilityClient(context),
                    this);
            router.start();
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (router != null) router.stop();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject reply = new JSObject();
        reply.put("available", available);
        call.resolve(reply);
    }

    @PluginMethod
    public void status(PluginCall call) {
        statusMap(call::resolve);
    }

    void statusMap(Consumer<JSObject> result) {
        if (!available) {
            result.accept(toJsObject(WatchLinkStatus.status(false, false, false, false, lastSyncAt)));
            return;
        }
        linkProbe.status(state -> result.accept(toJsObject(WatchLinkStatus.status(
                true, state.paired, state.installed, state.reachable, lastSyncAt))));
    }

    @PluginMethod
    public void sendSnapshot(PluginCall call) {
        if (sendSnapshotJson(call.getString("json"))) call.resolve();
        else call.reject("valid snapshot json is required");
    }

    boolean sendSnapshotJson(String json) {
        try {
            JSONObject value = new JSONObject(json);
            if (value.optInt("v", -1) != 1 || !value.has("builtAt")
                    || !value.has("settings") || value.isNull("settings")) return false;
            long builtAt = value.getLong("builtAt");
            boolean enabled = value.getJSONObject("settings").getBoolean("enabled");
            byte[] payload = json.getBytes(StandardCharsets.UTF_8);
            lastSnapshot = payload.clone();
            lastSyncAt = builtAt;
            transport.send(WearPaths.SNAPSHOT, payload);
            transport.putState(enabled, builtAt);
            return true;
        } catch (JSONException | NullPointerException error) {
            return false;
        }
    }

    @PluginMethod
    public void sendDetail(PluginCall call) {
        if (sendDetailJson(call.getString("json"))) call.resolve();
        else call.reject("valid detail json is required");
    }

    boolean sendDetailJson(String json) {
        try {
            JSONObject value = new JSONObject(json);
            String tokenId = value.getString("tokenId");
            if (value.optInt("v", -1) != 1 || tokenId.isEmpty()) return false;
            transport.send(WearPaths.detailPath(tokenId), json.getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (JSONException | NullPointerException error) {
            return false;
        }
    }

    @PluginMethod
    public void sendImage(PluginCall call) {
        if (sendImageData(call.getString("hash"), call.getString("base64"))) call.resolve();
        else call.reject("valid image hash and base64 are required");
    }

    boolean sendImageData(String hash, String base64) {
        byte[] bytes = WatchImagePayload.decode(hash, base64);
        if (bytes == null || (!imageDirectory.isDirectory() && !imageDirectory.mkdirs())) return false;
        File file = new File(imageDirectory, hash);
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
            transport.sendImage(hash, Uri.fromFile(file));
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    @PluginMethod
    public void removeWatchData(PluginCall call) {
        removeWatchDataAt(System.currentTimeMillis());
        call.resolve();
    }

    void removeWatchDataAt(long builtAt) {
        lastSnapshot = null;
        lastSyncAt = null;
        transport.removeWatchData(builtAt);
    }

    @Override
    public void onIntent(String kind, byte[] payload) {
        try {
            JSONObject value = new JSONObject(new String(payload, StandardCharsets.UTF_8));
            JSObject event = new JSObject();
            event.put("kind", kind);
            event.put("value", value);
            publishIntent(event);
        } catch (JSONException ignored) {}
    }

    void publishIntent(JSObject event) {
        notifyListeners("intent", event, false);
    }

    @Override
    public void onWatchNearby() {
        if (lastSnapshot != null) transport.send(WearPaths.SNAPSHOT, lastSnapshot.clone());
    }

    private static JSObject toJsObject(Map<String, Object> values) {
        JSObject result = new JSObject();
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            result.put(entry.getKey(), entry.getValue());
        }
        return result;
    }

    private static String installerPackageName(Context context) {
        PackageManager manager = context.getPackageManager();
        String packageName = context.getPackageName();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return manager.getInstallSourceInfo(packageName).getInstallingPackageName();
            }
            return manager.getInstallerPackageName(packageName);
        } catch (Exception error) {
            return null;
        }
    }

    private static final class GoogleLinkProbe implements LinkProbe {
        private final Context context;

        GoogleLinkProbe(Context context) {
            this.context = context;
        }

        @Override
        public void status(Consumer<LinkState> result) {
            Wearable.getNodeClient(context).getConnectedNodes()
                    .addOnSuccessListener(connected -> loadCapabilities(connected, result))
                    .addOnFailureListener(error -> result.accept(new LinkState(false, false, false)));
        }

        private void loadCapabilities(List<Node> connected, Consumer<LinkState> result) {
            Wearable.getCapabilityClient(context)
                    .getCapability(WearTransport.CAPABILITY, CapabilityClient.FILTER_ALL)
                    .addOnSuccessListener(all -> loadReachability(connected, all.getNodes(), result))
                    .addOnFailureListener(error -> result.accept(
                            new LinkState(!connected.isEmpty(), false, false)));
        }

        private void loadReachability(
                List<Node> connected, Set<Node> installedNodes, Consumer<LinkState> result) {
            boolean paired = !connected.isEmpty();
            boolean installed = connected.stream().anyMatch(connectedNode -> installedNodes.stream()
                    .anyMatch(node -> node.getId().equals(connectedNode.getId())));
            Wearable.getCapabilityClient(context)
                    .getCapability(WearTransport.CAPABILITY, CapabilityClient.FILTER_REACHABLE)
                    .addOnSuccessListener(reachable -> result.accept(new LinkState(
                            paired,
                            installed,
                            reachable.getNodes().stream().anyMatch(Node::isNearby))))
                    .addOnFailureListener(error -> result.accept(
                            new LinkState(paired, installed, false)));
        }
    }
}
