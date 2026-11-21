package pl.broniarek.gardenmanager;
import android.content.Context;
import android.net.nsd.*;
import android.net.wifi.WifiManager;
import android.util.Base64;
import org.json.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;

final class LanEngine {
    private final Context context;private LanIdentity identity;
    private volatile boolean active=false;private volatile long generation=0;
    private volatile Socket opening;private volatile LanChannel channel;
    private volatile LanWire pairingWire;private volatile JSONObject invitation,pending,last;
    private volatile boolean localConfirmed=false,remoteConfirmed=false;
    private volatile String diagnostic="Sesja komunikacji nie jest uruchomiona.";
    private final Map<String,JSONObject> discovered=new ConcurrentHashMap<>();
    private final ExecutorService readers=Executors.newCachedThreadPool(r->{Thread t=new Thread(r,"gm-lan");t.setDaemon(true);return t;});
    private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> expiry;private NsdManager.DiscoveryListener discovery;
    private WifiManager.MulticastLock multicast;
    LanEngine(Context context){this.context=context.getApplicationContext();}
    synchronized LanIdentity identity()throws Exception{if(identity==null)identity=new LanIdentity(context);return identity;}
    synchronized JSONObject view()throws Exception{
        LanIdentity d=identity();JSONArray peers=new JSONArray();for(JSONObject p:d.peers())peers.put(LanIdentity.publicPeer(p));
        JSONObject v=new JSONObject().put("supported",true).put("platform","android").put("device",LanIdentity.publicPeer(d.own()))
            .put("active",active).put("interfaces",new JSONArray()).put("peers",peers).put("discovered",new JSONArray(discovered.values()))
            .put("busy",channel!=null&&channel.busy).put("diagnostic",diagnostic);
        if(channel!=null&&channel.ready)v.put("connected",LanIdentity.publicPeer(channel.remote));if(last!=null)v.put("result",last);
        if(pending!=null)v.put("pending",new JSONObject(pending.toString()).put("localConfirmed",localConfirmed).put("remoteConfirmed",remoteConfirmed));
        return v;
    }
    synchronized void start()throws Exception{
        identity();if(active)throw new Exception("BUSY");active=true;long gen=++generation;
        expiry=timer.schedule(this::stop,15,TimeUnit.MINUTES);diagnostic="Sesja aktywna. Wybierz zaufany komputer albo zeskanuj jego kod parowania.";
        discover(gen);
    }
    void connect(String id,String host,int port)throws Exception{
        if(!active||channel!=null||pairingWire!=null)throw new Exception("CLOSED");
        long gen=generation;JSONObject peer=identity().peer(id);
        SSLSocket socket=LanTls.connect(identity(),peer,host,port,true,s->{opening=s;if(!active||generation!=gen)try{s.close();}catch(Exception ignored){}});
        synchronized(this){
            if(!active||generation!=gen){socket.close();throw new Exception("CLOSED");}
            channel=new LanChannel(socket,identity(),peer,r->last=r,c->{channel=null;diagnostic="Połączenie zakończone: "+c+". Możesz połączyć ponownie.";});
            opening=null;diagnostic="Trwa uwierzytelnianie zaufanego komputera.";
            LanChannel current=channel;readers.execute(current::run);
        }
    }
    private JSONObject parseInvitation(String text)throws Exception{
        if(text.length()>8192||!text.startsWith("GM011A:")||!text.substring(7).matches("[A-Za-z0-9_-]+"))throw new Exception("PAIRING");
        JSONObject i=new JSONObject(new String(Base64.decode(text.substring(7),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8));
        LanWire.fields(i,"v","host","port","pairPort","pairId","ticket","expiresAt","device");
        if(LanWire.integer(i,"v")!=1)throw new Exception("VERSION");LanWire.uuid(i.getString("pairId"));
        if(!i.getString("ticket").matches("[A-Za-z0-9_-]{43}")||!LanWire.privateAddress(i.getString("host")))throw new Exception("PAIRING");
        LanWire.port(LanWire.integer(i,"port"));LanWire.port(LanWire.integer(i,"pairPort"));
        long expires=i.getLong("expiresAt");if(expires<=System.currentTimeMillis()||expires>System.currentTimeMillis()+180000L)throw new Exception("EXPIRED");
        LanIdentity.validatePeer(i.getJSONObject("device"));return i;
    }
    void pair(String text)throws Exception{
        if(!active||channel!=null||pairingWire!=null)throw new Exception("CLOSED");
        JSONObject i=parseInvitation(text),peer=i.getJSONObject("device");long gen=generation;
        for(JSONObject old:identity().peers())if(old.getString("id").equals(peer.getString("id"))&&!old.getString("fingerprint").equals(peer.getString("fingerprint")))throw new Exception("IDENTITY");
        SSLSocket socket=LanTls.connect(identity(),peer,i.getString("host"),i.getInt("pairPort"),false,s->{opening=s;if(!active||generation!=gen)try{s.close();}catch(Exception ignored){}});
        socket.setSoTimeout(120000);LanWire wire=new LanWire(socket.getInputStream(),socket.getOutputStream(),i.getString("pairId"));
        if(!active||generation!=gen){socket.close();throw new Exception("CLOSED");}
        opening=null;pairingWire=wire;invitation=i;localConfirmed=false;remoteConfirmed=false;
        String ticket=i.getString("ticket");
        wire.send("pair",new JSONObject().put("ticket",ticket).put("device",identity().own()).put("signature",identity().proof(ticket,peer.getString("id"))));
        LanWire.Frame p=wire.receive();LanWire.fields(p.payload,"code");
        String expected=identity().code(ticket,peer.getString("id"));
        if(!p.type.equals("pair-pending")||!p.payload.getString("code").equals(expected))throw new Exception("IDENTITY");
        pending=LanIdentity.publicPeer(peer).put("code",expected);diagnostic="Porównaj kod i tożsamość na obu ekranach. Potwierdź tylko zgodne urządzenia.";
        readers.execute(()->pairLoop(wire,i,gen,expected));
    }
    private void pairLoop(LanWire wire,JSONObject i,long gen,String expected){
        try{
            while(active&&generation==gen&&pairingWire==wire){
                LanWire.Frame m=wire.receive();
                if(m.type.equals("pair-approved")){
                    LanWire.fields(m.payload,"code");if(remoteConfirmed||!m.payload.getString("code").equals(expected))throw new Exception("REPLAY");remoteConfirmed=true;
                }else if(m.type.equals("pair-done")){
                    LanWire.fields(m.payload,"deviceId","code");
                    if(!localConfirmed||!remoteConfirmed||!m.payload.getString("code").equals(expected)||!m.payload.getString("deviceId").equals(i.getJSONObject("device").getString("id")))throw new Exception("IDENTITY");
                    if(!active||generation!=gen)throw new Exception("CLOSED");
                    identity().trust(i.getJSONObject("device"));pairingWire=null;pending=null;invitation=null;
                    try{wire.close();}catch(Exception ignored){}closeSocket();wire=null;
                    diagnostic="Parowanie zapisane. Nawiąż połączenie z zaufanym komputerem.";return;
                }else throw new Exception("PROTOCOL");
            }
        }catch(Exception e){diagnostic=message(e);try{closeSocket();}catch(Exception ignored){}}
        finally{if(wire!=null&&pairingWire==wire){pairingWire=null;pending=null;invitation=null;}}
    }
    void confirm()throws Exception{
        LanWire wire=pairingWire;JSONObject p=pending;
        if(wire==null||p==null||localConfirmed||!active)throw new Exception("PAIRING");
        localConfirmed=true;wire.send("pair-confirm",new JSONObject().put("code",p.getString("code")));
    }
    void rename(String name)throws Exception{identity().rename(name);}
    void forget(String id)throws Exception{
        identity().forget(id);LanChannel c=channel;if(c!=null&&c.remote.getString("id").equals(id))c.close("CLOSED");
        if(pending!=null&&pending.getString("id").equals(id)){closeSocket();pending=null;pairingWire=null;}
    }
    JSONObject test(int bytes,String kind)throws Exception{
        LanChannel c=channel;if(c==null)throw new Exception("DISCONNECTED");
        try{return c.test(bytes,kind).get(120,TimeUnit.SECONDS);}catch(Exception e){c.close("TIMEOUT");throw e;}
    }
    private synchronized void discover(long gen){
        try{
            WifiManager wifi=(WifiManager)context.getSystemService(Context.WIFI_SERVICE);
            multicast=wifi.createMulticastLock("GardenManager-LAN");multicast.setReferenceCounted(false);multicast.acquire();
            NsdManager manager=(NsdManager)context.getSystemService(Context.NSD_SERVICE);
            java.util.concurrent.atomic.AtomicBoolean resolving=new java.util.concurrent.atomic.AtomicBoolean();
            Queue<NsdServiceInfo> queue=new ConcurrentLinkedQueue<>();
            Runnable[] next=new Runnable[1];next[0]=()->{
                if(!active||generation!=gen||!resolving.compareAndSet(false,true))return;
                NsdServiceInfo item=queue.poll();if(item==null){resolving.set(false);return;}
                manager.resolveService(item,new NsdManager.ResolveListener(){
                    public void onResolveFailed(NsdServiceInfo s,int error){resolving.set(false);next[0].run();}
                    public void onServiceResolved(NsdServiceInfo s){
                        try{
                            if(active&&generation==gen){
                                byte[] idBytes=s.getAttributes().get("id"),version=s.getAttributes().get("v");
                                if(idBytes==null||version==null||idBytes.length>80)throw new Exception("PROTOCOL");
                                String id=new String(idBytes,StandardCharsets.UTF_8),v=new String(version,StandardCharsets.US_ASCII),host=s.getHost().getHostAddress();
                                LanWire.uuid(id);LanWire.port(s.getPort());
                                if(v.equals("1")&&LanWire.privateAddress(host))discovered.put(id,new JSONObject().put("id",id).put("host",host).put("port",s.getPort()));
                            }
                        }catch(Exception ignored){}finally{resolving.set(false);next[0].run();}
                    }
                });
            };
            discovery=new NsdManager.DiscoveryListener(){
                public void onDiscoveryStarted(String t){}
                public void onDiscoveryStopped(String t){}
                public void onStartDiscoveryFailed(String t,int error){diagnostic="Wykrywanie jest niedostępne. Użyj kodu parowania lub ręcznego IP i portu.";}
                public void onStopDiscoveryFailed(String t,int error){}
                public void onServiceFound(NsdServiceInfo s){if(active&&generation==gen&&s.getServiceName().startsWith("GM-")&&queue.size()<20){queue.add(s);next[0].run();}}
                public void onServiceLost(NsdServiceInfo s){String n=s.getServiceName();if(n.startsWith("GM-"))discovered.remove(n.substring(3));}
            };
            manager.discoverServices("_gardenmanager._tcp.",NsdManager.PROTOCOL_DNS_SD,discovery);
        }catch(Exception e){diagnostic="Wykrywanie jest niedostępne. Użyj ręcznego adresu; hotspot lub sieć może blokować mDNS.";}
    }
    private void closeSocket(){Socket s=opening;opening=null;if(s!=null)try{s.close();}catch(Exception ignored){}
        LanWire p=pairingWire;if(p!=null)try{p.close();}catch(Exception ignored){}}
    synchronized void stop(){
        active=false;++generation;if(expiry!=null)expiry.cancel(false);expiry=null;
        closeSocket();pairingWire=null;pending=null;invitation=null;localConfirmed=false;remoteConfirmed=false;
        LanChannel c=channel;channel=null;if(c!=null)c.close("CLOSED");
        if(discovery!=null)try{((NsdManager)context.getSystemService(Context.NSD_SERVICE)).stopServiceDiscovery(discovery);}catch(Exception ignored){}discovery=null;
        if(multicast!=null&&multicast.isHeld())multicast.release();multicast=null;discovered.clear();
        diagnostic="Sesja zakończona. Połączenie i wykrywanie zostały zamknięte.";
    }
    void destroy(){stop();readers.shutdownNow();timer.shutdownNow();}
    static String code(Throwable error){
        if(error instanceof javax.net.ssl.SSLException||error instanceof java.security.GeneralSecurityException)return "CERTIFICATE";
        if(error instanceof java.net.SocketTimeoutException||error instanceof TimeoutException)return "TIMEOUT";
        String s=error.getMessage();return Arrays.asList("PROTOCOL","VERSION","LIMIT","REPLAY","CERTIFICATE","IDENTITY","BUSY","TIMEOUT","DISCONNECTED","INTEGRITY","CLOSED","VAULT","UNPAIRED","PAIRING","EXPIRED","ADDRESS").contains(s)?s:"DISCONNECTED";
    }
    static String message(Throwable e){
        switch(code(e)){
            case "CERTIFICATE":case "IDENTITY":return "Nie potwierdzono tożsamości TLS. Sprawdź kod, sparowanie i datę obu urządzeń. Nie akceptuj zmienionego klucza.";
            case "VAULT":return "Chroniony magazyn urządzenia jest niedostępny. Nie zmieniono jego zawartości ani danych firmowych.";
            case "EXPIRED":return "Zaproszenie wygasło lub zegary się różnią. Sprawdź datę i pokaż nowy kod na Windows.";
            case "ADDRESS":return "Podaj prywatny adres IPv4 komputera w tej samej sieci LAN.";
            case "UNPAIRED":return "Urządzenie nie jest sparowane. Użyj nowego kodu parowania z właściwego komputera.";
            case "BUSY":return "Dokończ poprzednią operację komunikacji.";
            case "CLOSED":return "Rozpocznij sesję komunikacji i wybierz zaufane urządzenie.";
            default:return "Nie udało się nawiązać lub utrzymać połączenia. Sprawdź IP, port, aktywną sesję Windows, zaporę, uprawnienia LAN i izolację urządzeń. Internet nie jest wymagany.";
        }
    }
}
