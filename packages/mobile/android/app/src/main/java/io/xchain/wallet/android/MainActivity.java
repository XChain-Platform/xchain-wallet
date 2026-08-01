package io.xchain.wallet.android;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import io.xchain.wallet.android.links.XChainLinksPlugin;
import io.xchain.wallet.android.vault.XChainVaultPlugin;

/**
 * The app's single exported component: launcher now, deep-link target from
 * S3. Capacitor's BridgeActivity is a FragmentActivity, which is what
 * BiometricPrompt requires of its host.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registration must happen BEFORE super.onCreate: that is where the
        // Bridge is built, and a plugin registered afterwards is missing from
        // the map the WebView sees. The symptom would not be a crash - it
        // would be the wallet quietly falling back to WebView storage, in an
        // app whose backup posture assumes the vault is in native storage.
        registerPlugin(XChainVaultPlugin.class);
        registerPlugin(XChainLinksPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
