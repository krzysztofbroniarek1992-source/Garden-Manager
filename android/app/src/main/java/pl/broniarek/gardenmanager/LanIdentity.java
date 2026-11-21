package pl.broniarek.gardenmanager;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.security.spec.ECGenParameterSpec;
import java.text.Normalizer;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.security.auth.x500.X500Principal;

/** Installation credentials never enter Data v12, WebView storage or corporate backups. */
final class LanIdentity {
    static final String SIGNING="gm011a.signing", VAULT="gm011a.vault";
    private final SharedPreferences prefs;
    private final KeyStore keys;
    private JSONObject data;
    LanIdentity(Context context)throws Exception {
        prefs=context.getSharedPreferences("gm011a-identity",Context.MODE_PRIVATE);
        keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        String encoded=prefs.getString("sealed",null);
        if(encoded==null) {
            if(keys.containsAlias(SIGNING)||keys.containsAlias(VAULT))throw new Exception("VAULT");
            String id=UUID.randomUUID().toString();
            KeyPairGenerator gen=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
            gen.initialize(new KeyGenParameterSpec.Builder(SIGNING,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256)
                .setCertificateSubject(new X500Principal("CN="+dns(id)))
                .setCertificateSerialNumber(new BigInteger(127,new SecureRandom()).add(BigInteger.ONE))
                .setCertificateNotBefore(new Date(System.currentTimeMillis()-86400000L))
                .setCertificateNotAfter(new Date(System.currentTimeMillis()+10L*365*86400000L)).build());
            gen.generateKeyPair();
            KeyGenerator aes=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            aes.init(new KeyGenParameterSpec.Builder(VAULT,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            aes.generateKey();
            data=new JSONObject().put("v",1).put("id",id).put("name","Telefon Android").put("peers",new JSONArray());
            persist(data);
        } else {
            JSONObject envelope=new JSONObject(encoded);
            byte[] iv=Base64.decode(envelope.getString("iv"),Base64.NO_WRAP);
            if(iv.length!=12)throw new Exception("VAULT");
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,keys.getKey(VAULT,null),new GCMParameterSpec(128,iv));
            cipher.updateAAD("GM011A native installation v1".getBytes(StandardCharsets.UTF_8));
            data=new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("ciphertext"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
        }
        LanWire.fields(data,"v","id","name","peers");
        if(data.getInt("v")!=1)throw new Exception("VAULT");
        LanWire.uuid(id());LanWire.name(name());checkCertificate(cert(),id());
        if(data.getJSONArray("peers").length()>20)throw new Exception("VAULT");
        Set<String> ids=new HashSet<>();
        for(JSONObject p:peers())if(!ids.add(p.getString("id"))||p.getString("id").equals(id()))throw new Exception("VAULT");
    }
    private void persist(JSONObject next)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,keys.getKey(VAULT,null));
        cipher.updateAAD("GM011A native installation v1".getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext=cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject sealed=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
            .put("ciphertext",Base64.encodeToString(ciphertext,Base64.NO_WRAP));
        if(!prefs.edit().putString("sealed",sealed.toString()).commit())throw new Exception("VAULT");
        data=next;
    }
    synchronized String id()throws Exception{return data.getString("id");}
    synchronized String name()throws Exception{return data.getString("name");}
    synchronized void rename(String name)throws Exception{JSONObject next=new JSONObject(data.toString());next.put("name",LanWire.name(name));persist(next);}
    X509Certificate cert()throws Exception{return (X509Certificate)keys.getCertificate(SIGNING);}
    PrivateKey key()throws Exception{return (PrivateKey)keys.getKey(SIGNING,null);}
    static String dns(String id)throws Exception{LanWire.uuid(id);return "gm-"+id+".local";}
    static X509Certificate parseCertificate(String pem,String id)throws Exception{
        if(pem.length()>4096||!pem.startsWith("-----BEGIN CERTIFICATE-----"))throw new Exception("CERTIFICATE");
        X509Certificate c=(X509Certificate)CertificateFactory.getInstance("X.509").generateCertificate(new java.io.ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII)));
        checkCertificate(c,id);return c;
    }
    static void checkCertificate(X509Certificate c,String id)throws Exception{
        c.checkValidity();c.verify(c.getPublicKey());
        if(!c.getSubjectX500Principal().equals(new X500Principal("CN="+dns(id)))||!"EC".equals(c.getPublicKey().getAlgorithm()))throw new Exception("CERTIFICATE");
        java.security.interfaces.ECPublicKey key=(java.security.interfaces.ECPublicKey)c.getPublicKey();
        AlgorithmParameters p=AlgorithmParameters.getInstance("EC");p.init(new ECGenParameterSpec("secp256r1"));
        if(!key.getParams().getOrder().equals(p.getParameterSpec(java.security.spec.ECParameterSpec.class).getOrder()))throw new Exception("CERTIFICATE");
    }
    static JSONObject validatePeer(JSONObject p)throws Exception{
        LanWire.fields(p,"id","name","cert","fingerprint");String id=p.getString("id");LanWire.uuid(id);LanWire.name(p.getString("name"));
        X509Certificate c=parseCertificate(p.getString("cert"),id);
        if(!LanWire.sha(c.getEncoded()).equals(p.getString("fingerprint")))throw new Exception("CERTIFICATE");return p;
    }
    static JSONObject publicPeer(JSONObject p)throws Exception{return new JSONObject().put("id",p.getString("id")).put("name",p.getString("name")).put("fingerprint",p.getString("fingerprint"));}
    synchronized JSONObject own()throws Exception{
        String pem="-----BEGIN CERTIFICATE-----\n"+Base64.encodeToString(cert().getEncoded(),Base64.NO_WRAP).replaceAll("(.{64})","$1\n")+"\n-----END CERTIFICATE-----\n";
        return new JSONObject().put("id",id()).put("name",name()).put("cert",pem).put("fingerprint",LanWire.sha(cert().getEncoded()));
    }
    synchronized List<JSONObject> peers()throws Exception{
        List<JSONObject> result=new ArrayList<>();JSONArray a=data.getJSONArray("peers");
        for(int i=0;i<a.length();i++)result.add(validatePeer(a.getJSONObject(i)));return result;
    }
    synchronized JSONObject peer(String id)throws Exception{for(JSONObject p:peers())if(p.getString("id").equals(id))return p;throw new Exception("UNPAIRED");}
    synchronized void trust(JSONObject p)throws Exception{
        validatePeer(p);if(p.getString("id").equals(id()))throw new Exception("IDENTITY");
        JSONArray a=new JSONArray();for(JSONObject old:peers()){
            if(old.getString("id").equals(p.getString("id"))){
                if(!old.getString("fingerprint").equals(p.getString("fingerprint")))throw new Exception("IDENTITY");
            }else a.put(old);
        }
        a.put(p);if(a.length()>20)throw new Exception("LIMIT");JSONObject next=new JSONObject(data.toString()).put("peers",a);persist(next);
    }
    synchronized void forget(String id)throws Exception{
        LanWire.uuid(id);JSONArray a=new JSONArray();for(JSONObject p:peers())if(!p.getString("id").equals(id))a.put(p);
        persist(new JSONObject(data.toString()).put("peers",a));
    }
    byte[] transcript(String ticket,String serverId)throws Exception{
        JSONObject p=own();return String.join("\n","GM011A-PAIR-v1",ticket,serverId,id(),p.getString("fingerprint"),name()).getBytes(StandardCharsets.UTF_8);
    }
    String proof(String ticket,String serverId)throws Exception{
        Signature s=Signature.getInstance("SHA256withECDSA");s.initSign(key());s.update(transcript(ticket,serverId));return Base64.encodeToString(s.sign(),Base64.NO_WRAP);
    }
    String code(String ticket,String serverId)throws Exception{
        long n=Long.parseLong(LanWire.sha(transcript(ticket,serverId)).substring(0,8),16)%100000000L;
        return String.format(Locale.ROOT,"%08d",n);
    }
}
