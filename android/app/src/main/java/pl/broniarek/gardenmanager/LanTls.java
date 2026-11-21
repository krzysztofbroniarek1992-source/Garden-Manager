package pl.broniarek.gardenmanager;
import org.json.JSONObject;
import javax.net.ssl.*;
import java.net.*;
import java.security.*;
import java.security.cert.X509Certificate;

final class LanTls {
    /** Trust only the explicit device certificate. Standard PKIX and HTTPS SAN
     * verification remain enabled, using its stable identity hostname over the IP socket. */
    static SSLSocket connect(LanIdentity identity,JSONObject peer,String host,int port,boolean clientCertificate,java.util.function.Consumer<Socket> opening)throws Exception{
        if(!LanWire.privateAddress(host))throw new Exception("ADDRESS");LanWire.port(port);LanIdentity.validatePeer(peer);
        String id=peer.getString("id");X509Certificate cert=LanIdentity.parseCertificate(peer.getString("cert"),id);
        KeyStore trust=KeyStore.getInstance(KeyStore.getDefaultType());trust.load(null);trust.setCertificateEntry("pinned-device",cert);
        TrustManagerFactory tm=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());tm.init(trust);
        KeyManager[] km=null;
        if(clientCertificate)km=new KeyManager[]{new X509ExtendedKeyManager(){
            public String[] getClientAliases(String t,java.security.Principal[] i){return new String[]{"device"};}
            public String chooseClientAlias(String[] t,java.security.Principal[] i,Socket s){return "device";}
            public String[] getServerAliases(String t,java.security.Principal[] i){return null;}
            public String chooseServerAlias(String t,java.security.Principal[] i,Socket s){return null;}
            public X509Certificate[] getCertificateChain(String a){try{return new X509Certificate[]{identity.cert()};}catch(Exception e){return null;}}
            public PrivateKey getPrivateKey(String a){try{return identity.key();}catch(Exception e){return null;}}
        }};
        SSLContext context=SSLContext.getInstance("TLS");context.init(km,tm.getTrustManagers(),new SecureRandom());
        Socket raw=new Socket();opening.accept(raw);
        try{
            raw.connect(new InetSocketAddress(host,port),5000);
            SSLSocket socket=(SSLSocket)context.getSocketFactory().createSocket(raw,LanIdentity.dns(id),port,true);opening.accept(socket);
            java.util.List<String> protocols=new java.util.ArrayList<>();
            for(String p:socket.getSupportedProtocols())if(p.equals("TLSv1.3")||p.equals("TLSv1.2"))protocols.add(p);
            socket.setEnabledProtocols(protocols.toArray(new String[0]));
            java.util.List<String> suites=new java.util.ArrayList<>();
            for(String s:socket.getSupportedCipherSuites())if(s.equals("TLS_AES_128_GCM_SHA256")||s.equals("TLS_AES_256_GCM_SHA384")||s.equals("TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256")||s.equals("TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384"))suites.add(s);
            socket.setEnabledCipherSuites(suites.toArray(new String[0]));
            SSLParameters parameters=socket.getSSLParameters();parameters.setEndpointIdentificationAlgorithm("HTTPS");socket.setSSLParameters(parameters);
            socket.setSoTimeout(10000);socket.startHandshake();
            X509Certificate remote=(X509Certificate)socket.getSession().getPeerCertificates()[0];remote.checkValidity();
            if(!MessageDigest.isEqual(cert.getEncoded(),remote.getEncoded()))throw new Exception("CERTIFICATE");
            socket.setSoTimeout(90000);return socket;
        }catch(Exception e){raw.close();throw e;}
    }
}
