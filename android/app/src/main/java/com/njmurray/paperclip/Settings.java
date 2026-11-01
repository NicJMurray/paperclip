package com.njmurray.paperclip;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class Settings {
    static final String ORIGIN = "https://paperclip.njmurray.com";
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias("paperclip-token")) return (SecretKey) store.getKey("paperclip-token", null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder("paperclip-token", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    static void saveToken(Context context, String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String value = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("value", Base64.encodeToString(cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP)).toString();
        if (!context.getSharedPreferences("connection", 0).edit().putString("token", value).commit()) throw new Exception("Could not store the connection.");
    }
    static String token(Context context) {
        try {
            String saved = context.getSharedPreferences("connection",0).getString("token", null); if (saved == null) return null;
            JSONObject obj = new JSONObject(saved); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128,Base64.decode(obj.getString("iv"),Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(obj.getString("value"),Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) { return null; }
    }
}
