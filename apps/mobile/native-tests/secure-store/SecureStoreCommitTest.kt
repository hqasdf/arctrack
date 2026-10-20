package expo.modules.securestore

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import android.util.Base64
import expo.modules.core.ModuleRegistry
import expo.modules.kotlin.exception.CodedException
import expo.modules.securestore.encryptors.AESEncryptor
import java.lang.reflect.InvocationTargetException
import java.security.Key
import java.security.KeyStore
import java.security.KeyStoreSpi
import java.security.cert.Certificate
import java.util.Collections
import java.util.Date
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Actual module/encryptor tests. The in-memory key store replaces hardware, not encryption.
 * These JVM tests do not execute the JSI bridge or establish power-loss durability.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class SecureStoreCommitTest {
  private val options = SecureStoreOptions(keychainService = "arc-test", requireAuthentication = false)
  private val key = "synthetic-session"
  private val plaintext = "synthetic-value-not-an-auth-session"
  private val secret = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
  private lateinit var prefs: CommitPreferences
  private lateinit var module: SecureStoreModule

  @Before
  fun setUp() {
    val context = RuntimeEnvironment.getApplication()
    val realPrefs = context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)
    realPrefs.edit().clear().commit()
    prefs = CommitPreferences(realPrefs)
    val wrappedContext = object : ContextWrapper(context) {
      override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
        if (name == "SecureStore") prefs else super.getSharedPreferences(name, mode)
    }
    module = object : SecureStoreModule() {
      override val reactContext: Context = wrappedContext
    }
    val alias = AESEncryptor().getExtendedKeyStoreAlias(options, false)
    val store = TestKeyStore(alias, KeyStore.SecretKeyEntry(secret)).apply { load(null, null) }
    setPrivateField("keyStore", store)
    setPrivateField("authenticationHelper", AuthenticationHelper(wrappedContext, ModuleRegistry(emptyList(), emptyList())))
  }

  @Test
  fun successfulCommitEncryptsAndReadsThroughActualModule() = runBlocking {
    callSuspend("setItemImpl", key, plaintext, options, false)
    assertEquals(plaintext, callSuspend("getItemImpl", key, options))
    assertEquals(setOf("arc-test-$key"), prefs.all.keys)
    val encoded = prefs.getString("arc-test-$key", null)!!
    assertFalse(encoded.contains(plaintext))
    val item = JSONObject(encoded)
    assertEquals(setOf("ct", "iv", "tlen", "scheme", "usesKeystoreSuffix", "keystoreAlias", "requireAuthentication"), item.keys().asSequence().toSet())
    assertEquals("aes", item.getString("scheme"))
    assertEquals("arc-test", item.getString("keystoreAlias"))
    assertTrue(item.getBoolean("usesKeystoreSuffix"))
    assertFalse(item.getBoolean("requireAuthentication"))
  }

  @Test
  fun falseCommitThrowsWriteExceptionEvenWhenValueCanBeReadBack() = runBlocking {
    // Deliberately retain the real write while returning false: failure is uncertain, not rollback.
    prefs.acknowledge = false
    val error = try {
      callSuspend("setItemImpl", key, plaintext, options, false)
      fail("Encrypted write must reject an unsuccessful native acknowledgment")
      null
    } catch (error: CodedException) {
      error
    }
    assertNotNull(error)
    assertEquals("ERR_WRITE", error!!.code)
    assertTrue(error.message!!.contains("Could not persist encrypted value to SecureStore"))
    assertEquals(1, prefs.commitCalls)
    assertEquals(plaintext, callSuspend("getItemImpl", key, options))
  }

  @Test
  fun falseCommitDoesNotRemoveLegacyAlias() = runBlocking {
    prefs.edit().putString(key, "legacy-sentinel").commit()
    prefs.acknowledge = false
    try {
      callSuspend("setItemImpl", key, plaintext, options, false)
      fail("Expected write failure")
    } catch (error: CodedException) {
      assertEquals("ERR_WRITE", error.code)
    }
    assertEquals("legacy-sentinel", prefs.getString(key, null))
  }

  @Test
  fun prePatchFormatEncryptedFixtureRemainsReadable() = runBlocking {
    // The fixture is encoded independently of setItemImpl using its pre-patch JSON schema.
    val iv = ByteArray(12) { (it + 10).toByte() }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secret, GCMParameterSpec(128, iv))
    val fixture = JSONObject()
      .put("ct", Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
      .put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
      .put("tlen", 128)
      .put("scheme", "aes")
      .put("usesKeystoreSuffix", true)
      .put("keystoreAlias", "arc-test")
      .put("requireAuthentication", false)
      .toString()
    prefs.edit().putString("arc-test-$key", fixture).commit()
    assertEquals(plaintext, callSuspend("getItemImpl", key, options))
    assertEquals(fixture, prefs.getString("arc-test-$key", null))
  }

  private fun setPrivateField(name: String, value: Any) {
    SecureStoreModule::class.java.getDeclaredField(name).apply { isAccessible = true }.set(module, value)
  }

  private suspend fun callSuspend(name: String, vararg arguments: Any?): Any? =
    suspendCoroutineUninterceptedOrReturn { continuation ->
      val method = SecureStoreModule::class.java.declaredMethods.single { it.name == name }
      method.isAccessible = true
      try {
        method.invoke(module, *arguments, continuation)
      } catch (error: InvocationTargetException) {
        throw error.targetException
      }
    }
}

private class CommitPreferences(private val delegate: SharedPreferences) : SharedPreferences by delegate {
  var acknowledge = true
  var commitCalls = 0
  override fun edit(): SharedPreferences.Editor {
    val editor = delegate.edit()
    return object : SharedPreferences.Editor by editor {
      override fun putString(key: String?, value: String?): SharedPreferences.Editor {
        editor.putString(key, value)
        return this
      }
      override fun remove(key: String?): SharedPreferences.Editor {
        editor.remove(key)
        return this
      }
      override fun commit(): Boolean {
        commitCalls++
        val committed = editor.commit()
        return committed && acknowledge
      }
    }
  }
}

private class TestKeyStore(alias: String, entry: KeyStore.SecretKeyEntry) : KeyStore(
  object : KeyStoreSpi() {
    override fun engineGetEntry(requested: String, protection: KeyStore.ProtectionParameter?): KeyStore.Entry? = if (requested == alias) entry else null
    override fun engineContainsAlias(requested: String) = requested == alias
    override fun engineGetKey(requested: String, password: CharArray?): Key? = if (requested == alias) entry.secretKey else null
    override fun engineIsKeyEntry(requested: String) = requested == alias
    override fun engineAliases() = Collections.enumeration(listOf(alias))
    override fun engineSize() = 1
    override fun engineLoad(stream: java.io.InputStream?, password: CharArray?) = Unit
    override fun engineStore(stream: java.io.OutputStream?, password: CharArray?) = throw UnsupportedOperationException()
    override fun engineGetCreationDate(requested: String): Date? = null
    override fun engineGetCertificate(requested: String): Certificate? = null
    override fun engineGetCertificateChain(requested: String): Array<Certificate>? = null
    override fun engineGetCertificateAlias(certificate: Certificate): String? = null
    override fun engineIsCertificateEntry(requested: String) = false
    override fun engineSetKeyEntry(alias: String, key: Key, password: CharArray?, chain: Array<out Certificate>?) = throw UnsupportedOperationException()
    override fun engineSetKeyEntry(alias: String, key: ByteArray, chain: Array<out Certificate>?) = throw UnsupportedOperationException()
    override fun engineSetCertificateEntry(alias: String, certificate: Certificate) = throw UnsupportedOperationException()
    override fun engineDeleteEntry(alias: String) = throw UnsupportedOperationException()
  }, null, "ArcTrackTestOnly"
)
