package pl.broniarek.gardenmanager;
import org.json.*;
import javax.net.ssl.SSLSocket;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

final class LanChannel {
    final SSLSocket socket;final JSONObject remote;final LanWire wire;
    volatile boolean ready=false,busy=false,closed=false;private Probe probe;
    private final Consumer<JSONObject> result;private final Consumer<String> ended;
    private final LanIdentity identity;private final java.util.Timer deadlines=new java.util.Timer("gm-lan-deadline",true);
    private static final class Probe {
        String id,kind,sent="",received="";int bytes;boolean initiator,ack;
        long start;CompletableFuture<JSONObject> future;java.util.TimerTask timeout;
    }
    LanChannel(SSLSocket socket,LanIdentity identity,JSONObject remote,Consumer<JSONObject> result,Consumer<String> ended)throws Exception{
        this.socket=socket;this.identity=identity;this.remote=remote;this.result=result;this.ended=ended;
        wire=new LanWire(socket.getInputStream(),socket.getOutputStream(),"");
    }
    void run(){
        try{
            LanWire.Frame hello=wire.receive();LanWire.fields(hello.payload,"deviceId","name","nonce");
            if(!hello.type.equals("hello")||!hello.payload.getString("deviceId").equals(remote.getString("id")))throw new Exception("IDENTITY");
            LanWire.name(hello.payload.getString("name"));LanWire.uuid(hello.payload.getString("nonce"));
            wire.send("hello",new JSONObject().put("deviceId",identity.id()).put("name",identity.name()).put("nonce",UUID.randomUUID().toString()));
            ready=true;
            while(!closed){
                LanWire.Frame frame=wire.receive((m,n)->{
                    if(!m.getString("type").equals("data"))return n==0;
                    synchronized(this){return probe!=null&&n==probe.bytes&&m.getJSONObject("payload").optString("probeId").equals(probe.id);}
                });
                handle(frame);
            }
        }catch(Exception e){close(LanEngine.code(e));}
    }
    synchronized CompletableFuture<JSONObject> test(int bytes,String kind)throws Exception{
        LanWire.options(bytes,kind);if(!ready||probe!=null||closed)throw new Exception("BUSY");
        Probe p=create(UUID.randomUUID().toString(),bytes,kind,true);p.future=new CompletableFuture<>();
        wire.send("probe",new JSONObject().put("probeId",p.id).put("bytes",bytes).put("kind",kind));return p.future;
    }
    private Probe create(String id,int bytes,String kind,boolean initiator){
        Probe p=new Probe();p.id=id;p.bytes=bytes;p.kind=kind;p.initiator=initiator;p.start=System.nanoTime();p.timeout=new java.util.TimerTask(){public void run(){close("TIMEOUT");}};deadlines.schedule(p.timeout,120000);probe=p;busy=true;return p;
    }
    private void send(Probe p)throws Exception{
        byte[] body=LanWire.synthetic(p.bytes,p.kind);p.sent=LanWire.sha(body);
        wire.send("data",new JSONObject().put("probeId",p.id).put("bytes",p.bytes).put("kind",p.kind).put("sha256",p.sent),body);
    }
    private synchronized void handle(LanWire.Frame f)throws Exception{
        JSONObject v=f.payload;
        if(f.type.equals("bye")){LanWire.fields(v);close("CLOSED");return;}
        if(f.type.equals("error"))throw new Exception("PROTOCOL");
        if(f.type.equals("probe")){
            LanWire.fields(v,"probeId","bytes","kind");String id=v.getString("probeId"),kind=v.getString("kind");int bytes=LanWire.integer(v,"bytes");
            LanWire.uuid(id);LanWire.options(bytes,kind);if(probe!=null)throw new Exception("BUSY");
            send(create(id,bytes,kind,false));return;
        }
        Probe p=probe;if(p==null||!v.optString("probeId").equals(p.id))throw new Exception("REPLAY");
        if(System.nanoTime()-p.start>120000000000L)throw new Exception("TIMEOUT");
        switch(f.type){
            case "data":
                LanWire.fields(v,"probeId","bytes","kind","sha256");
                if(!p.received.isEmpty()||LanWire.integer(v,"bytes")!=p.bytes||!v.getString("kind").equals(p.kind)||f.body.length!=p.bytes)throw new Exception("PROTOCOL");
                String hash=LanWire.sha(f.body);
                if(!hash.equals(v.getString("sha256"))||!Arrays.equals(f.body,LanWire.synthetic(p.bytes,p.kind)))throw new Exception("INTEGRITY");
                p.received=hash;wire.send("ack",new JSONObject().put("probeId",p.id).put("sha256",hash));
                if(p.initiator)send(p);else finish(p);break;
            case "ack":
                LanWire.fields(v,"probeId","sha256");
                if(p.ack||p.sent.isEmpty()||!v.getString("sha256").equals(p.sent))throw new Exception("INTEGRITY");
                p.ack=true;if(!p.initiator)finish(p);break;
            case "done":
                LanWire.fields(v,"probeId","bytes","kind","sentSha256","receivedSha256","elapsedMs");
                if(!p.initiator||!p.ack||p.received.isEmpty()||LanWire.integer(v,"bytes")!=p.bytes||!v.getString("kind").equals(p.kind)||
                    !v.getString("sentSha256").equals(p.received)||!v.getString("receivedSha256").equals(p.sent)||
                    v.getDouble("elapsedMs")<0||v.getDouble("elapsedMs")>120000)throw new Exception("INTEGRITY");
                complete(p);break;
            default:throw new Exception("PROTOCOL");
        }
    }
    private JSONObject summary(Probe p)throws Exception{return new JSONObject().put("ok",true).put("bytes",p.bytes).put("kind",p.kind)
        .put("sentSha256",p.sent).put("receivedSha256",p.received).put("elapsedMs",(System.nanoTime()-p.start)/1000000L).put("at",System.currentTimeMillis());}
    private void complete(Probe p)throws Exception{p.timeout.cancel();JSONObject r=summary(p);probe=null;busy=false;result.accept(r);if(p.future!=null)p.future.complete(r);}
    private void finish(Probe p)throws Exception{
        if(p.received.isEmpty()||!p.ack)return;
        wire.send("done",new JSONObject().put("probeId",p.id).put("bytes",p.bytes).put("kind",p.kind)
            .put("sentSha256",p.sent).put("receivedSha256",p.received).put("elapsedMs",(System.nanoTime()-p.start)/1000000L));complete(p);
    }
    void close(String code){
        if(closed)return;closed=true;ready=false;deadlines.cancel();try{socket.close();}catch(Exception ignored){}
        synchronized(this){Probe p=probe;probe=null;busy=false;
            if(p!=null)try{JSONObject r=summary(p).put("ok",false).put("error",code);result.accept(r);if(p.future!=null)p.future.completeExceptionally(new Exception(code));}catch(Exception ignored){}
        }
        ended.accept(code);
    }
}
