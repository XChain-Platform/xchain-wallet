package io.xchain.wallet.android.wear

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

class ManifestComponentsTest {
    @Test
    fun declaredComponentsResolve() {
        val document = parse(repoFile("packages/mobile/android/wear/src/main/AndroidManifest.xml"))
        val components = listOf("activity", "service").flatMap { tag ->
            document.getElementsByTagName(tag).elements().map { it.androidAttribute("name") }
        }

        assertEquals(
            listOf(
                ".MainActivity",
                ".sync.WatchListenerService",
                ".tile.BalanceTileService",
                ".complication.WalletComplicationService",
            ),
            components,
        )
        components.forEach { name ->
            val source = "packages/mobile/android/wear/src/main/kotlin/io/xchain/wallet/android/wear/" +
                name.removePrefix(".").replace('.', '/') + ".kt"
            assertTrue(repoFile(source).isFile)
        }
        components.filterNot { it == ".MainActivity" }.forEach { name ->
            assertNotNull(Class.forName("io.xchain.wallet.android.wear${name}"))
        }
    }

    @Test
    fun capabilityResourcesMatchEachSide() {
        assertCapabilities(
            "packages/mobile/android/wear/src/main/res/values/wear.xml",
            "xchain_wear",
            "XChain",
        )
        assertCapabilities(
            "packages/mobile/android/app/src/main/res/values/wear.xml",
            "xchain_phone",
            null,
        )
    }

    private fun assertCapabilities(path: String, capability: String, appName: String?) {
        val document = parse(repoFile(path))
        val arrays = document.getElementsByTagName("string-array").elements()
            .filter { it.getAttribute("name") == "android_wear_capabilities" }
        assertEquals(1, arrays.size)
        assertEquals("false", arrays.single().getAttribute("translatable"))
        assertEquals(
            listOf(capability),
            arrays.single().getElementsByTagName("item").elements().map { it.textContent.trim() },
        )
        if (appName != null) {
            val names = document.getElementsByTagName("string").elements()
                .filter { it.getAttribute("name") == "app_name" }
            assertEquals(listOf(appName), names.map { it.textContent.trim() })
        }
    }

    private fun parse(file: File) = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
    }.newDocumentBuilder().parse(file)

    private fun repoFile(path: String): File {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        repeat(8) {
            File(directory, path).takeIf(File::isFile)?.let { return it }
            directory = directory.parentFile ?: return@repeat
        }
        throw AssertionError("Missing repository file: $path")
    }

    private fun org.w3c.dom.NodeList.elements(): List<Element> =
        (0 until length).map { item(it) as Element }

    private fun Element.androidAttribute(name: String): String =
        getAttributeNS("http://schemas.android.com/apk/res/android", name)
}
