package io.xchain.wallet.android.watch;

import android.content.Context;
import android.net.Uri;

import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.ChannelClient;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.Wearable;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

public final class WearTransport {

    static final String CAPABILITY = "xchain_wear";

    interface Backend {
        void nearbyNode(Consumer<String> result);
        void sendMessage(String node, String path, byte[] payload);
        void sendChannel(String node, String path, byte[] payload);
        void sendFile(String node, String path, Uri file);
        void putState(String path, boolean enabled, long builtAt);
    }

    private final Backend backend;

    public WearTransport(Context context) {
        this(new GoogleBackend(context));
    }

    WearTransport(Backend backend) {
        this.backend = backend;
    }

    public void nearbyNode(Consumer<String> result) {
        backend.nearbyNode(result);
    }

    public void status(Consumer<Boolean> result) {
        nearbyNode(node -> result.accept(node != null));
    }

    public void send(String path, byte[] payload) {
        if (!WearPaths.isWatchPath(path)) throw new IllegalArgumentException("invalid watch path");
        nearbyNode(node -> {
            if (node == null) return;
            if (WearPaths.useChannel(payload.length)) backend.sendChannel(node, path, payload);
            else backend.sendMessage(node, path, payload);
        });
    }

    public void sendImage(String hash, Uri file) {
        String path = WearPaths.imagePath(hash);
        nearbyNode(node -> {
            if (node != null) backend.sendFile(node, path, file);
        });
    }

    public void putState(boolean enabled, long builtAt) {
        backend.putState(WearPaths.STATE, enabled, builtAt);
    }

    public void removeWatchData(long builtAt) {
        String empty = "{\"v\":1,\"builtAt\":" + builtAt + ",\"balancesAt\":" + builtAt
                + ",\"pricesAt\":" + builtAt + ",\"session\":\"unlocked\",\"network\":"
                + "{\"kind\":\"mainnet\",\"isTest\":false},\"fiatCode\":\"USD\",\"hidden\":false,"
                + "\"unitDefault\":\"fiat\",\"walletName\":\"\",\"totals\":{\"fiatText\":\"\","
                + "\"unitsText\":\"Balances\"},\"rows\":[],\"capped\":false,\"receive\":[],\"inbox\":[],"
                + "\"settings\":{\"showTotal\":false,\"enabled\":false}}";
        send(WearPaths.SNAPSHOT, empty.getBytes(StandardCharsets.UTF_8));
        putState(false, builtAt);
    }

    private static final class GoogleBackend implements Backend {
        private final CapabilityClient capabilities;
        private final MessageClient messages;
        private final ChannelClient channels;
        private final DataClient data;

        GoogleBackend(Context context) {
            capabilities = Wearable.getCapabilityClient(context);
            messages = Wearable.getMessageClient(context);
            channels = Wearable.getChannelClient(context);
            data = Wearable.getDataClient(context);
        }

        @Override
        public void nearbyNode(Consumer<String> result) {
            capabilities.getCapability(CAPABILITY, CapabilityClient.FILTER_REACHABLE)
                    .addOnSuccessListener(info -> result.accept(info.getNodes().stream()
                            .filter(Node::isNearby).map(Node::getId).findFirst().orElse(null)))
                    .addOnFailureListener(error -> result.accept(null));
        }

        @Override
        public void sendMessage(String node, String path, byte[] payload) {
            messages.sendMessage(node, path, payload);
        }

        @Override
        public void sendChannel(String node, String path, byte[] payload) {
            channels.openChannel(node, path).addOnSuccessListener(channel ->
                    channels.getOutputStream(channel).addOnSuccessListener(output -> {
                        try {
                            output.write(payload);
                            output.close();
                        } catch (IOException ignored) {}
                    }));
        }

        @Override
        public void sendFile(String node, String path, Uri file) {
            channels.openChannel(node, path).addOnSuccessListener(channel ->
                    channels.sendFile(channel, file));
        }

        @Override
        public void putState(String path, boolean enabled, long builtAt) {
            PutDataMapRequest request = PutDataMapRequest.create(path);
            request.getDataMap().putBoolean("enabled", enabled);
            request.getDataMap().putLong("builtAt", builtAt);
            data.putDataItem(request.asPutDataRequest());
        }
    }
}
