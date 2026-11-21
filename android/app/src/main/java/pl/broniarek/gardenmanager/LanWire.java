package pl.broniarek.gardenmanager;
import org.json.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;

final class LanWire {
    static final int MAX_HEADER=8192,MAX_BODY=10485760;
    private final DataInputStream in;private final DataOutputStream out;
    String sid;private int incoming=0,outgoing=0;private final Set<String> seen=new HashSet<>();
    LanWire(InputStream input,OutputStream output,String sid){in=new DataInputStream(new BufferedInputStream(input));out=new DataOutputStream(new BufferedOutputStream(output));this.sid=sid;}
    static void uuid(String value)throws Exception{if(!value.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))throw new Exception("PROTOCOL");}
    static String name(String value)throws Exception{
        if(value.trim().isEmpty()||value.length()>80||value.matches("(?s).*[\\x00-\\x1f\\x7f<>|\\\\/\"'].*"))throw new Exception("PROTOCOL");
        return Normalizer.normalize(value.trim(),Normalizer.Form.NFC);
    }
    static void fields(JSONObject value,String... keys)throws Exception{
        Set<String> a=new HashSet<>();Iterator<String> it=value.keys();while(it.hasNext())a.add(it.next());
        if(!a.equals(new HashSet<>(Arrays.asList(keys))))throw new Exception("PROTOCOL");
    }
    static boolean privateAddress(String value){
        if(!value.matches("\\d{1,3}(\\.\\d{1,3}){3}"))return false;
        String[] s=value.split("\\.");int[] n=new int[4];for(int i=0;i<4;i++){n[i]=Integer.parseInt(s[i]);if(n[i]>255||!String.valueOf(n[i]).equals(s[i]))return false;}
        return n[0]==10||n[0]==172&&n[1]>=16&&n[1]<=31||n[0]==192&&n[1]==168;
    }
    static void port(int n)throws Exception{if(n<1024||n>65535)throw new Exception("PROTOCOL");}
    static void options(int bytes,String kind)throws Exception{if(!(bytes==1024||bytes==102400||bytes==1048576||bytes==MAX_BODY)||!(kind.equals("json")||kind.equals("binary")))throw new Exception("PROTOCOL");}
    static String sha(byte[] b)throws Exception{byte[] h=MessageDigest.getInstance("SHA-256").digest(b);StringBuilder s=new StringBuilder();for(byte v:h)s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString();}
    static byte[] synthetic(int bytes,String kind)throws Exception{
        options(bytes,kind);byte[] b=new byte[bytes];
        if(kind.equals("binary")){for(int i=0;i<bytes;i++)b[i]=(byte)((i*31L+17)%251);return b;}
        byte[] prefix="{\"kind\":\"gm011a-synthetic\",\"padding\":\"".getBytes(StandardCharsets.US_ASCII),suffix="\"}".getBytes(StandardCharsets.US_ASCII);
        Arrays.fill(b,(byte)'A');System.arraycopy(prefix,0,b,0,prefix.length);System.arraycopy(suffix,0,b,bytes-suffix.length,suffix.length);return b;
    }
    static int integer(JSONObject p,String key)throws Exception{
        Object v=p.get(key);if(!(v instanceof Number)||((Number)v).doubleValue()!=((Number)v).intValue())throw new Exception("PROTOCOL");return ((Number)v).intValue();
    }
    static final class Frame {final JSONObject header,payload;final String type;final byte[] body;Frame(JSONObject h,byte[] b)throws Exception{header=h;payload=h.getJSONObject("payload");type=h.getString("type");body=b;
            Set<String> strings=new HashSet<>(Arrays.asList("deviceId","name","nonce","probeId","kind","sha256","code","sentSha256","receivedSha256","signature","ticket"));
            Iterator<String> it=payload.keys();while(it.hasNext()){String key=it.next();if(strings.contains(key)&&!(payload.get(key) instanceof String))throw new Exception("PROTOCOL");}
        }}
    interface BodyPolicy{boolean allow(JSONObject header,int bytes)throws Exception;}
    Frame receive(BodyPolicy policy)throws Exception{
        int length=in.readInt();if(length<2||length>MAX_HEADER)throw new Exception("LIMIT");
        byte[] h=new byte[length];in.readFully(h);
        String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(h)).toString();
        JSONObject m=new JSONObject(text);fields(m,"v","type","id","seq","sid","payload");
        if(integer(m,"v")!=1)throw new Exception("VERSION");
        String id=m.getString("id"),remoteSid=m.getString("sid"),type=m.getString("type");uuid(id);uuid(remoteSid);
        if(!Arrays.asList("hello","probe","data","ack","done","bye","error","pair","pair-pending","pair-confirm","pair-approved","pair-done").contains(type))throw new Exception("PROTOCOL");
        if(sid.isEmpty()&&type.equals("hello")&&integer(m,"seq")==0)sid=remoteSid;
        int seq=integer(m,"seq");if(seq>8192||seq!=incoming++||!sid.equals(remoteSid)||!seen.add(id))throw new Exception("REPLAY");
        int bytes=in.readInt();if(bytes<0||bytes>MAX_BODY||!policy.allow(m,bytes))throw new Exception("LIMIT");
        byte[] body=new byte[bytes];in.readFully(body);return new Frame(m,body);
    }
    void close()throws IOException{try{in.close();}finally{out.close();}}
    Frame receive()throws Exception{return receive((m,n)->n==0);}
    synchronized void send(String type,JSONObject payload,byte[] body)throws Exception{
        if(body.length>MAX_BODY||outgoing>8192)throw new Exception("LIMIT");
        JSONObject m=new JSONObject().put("v",1).put("type",type).put("id",UUID.randomUUID().toString()).put("seq",outgoing++).put("sid",sid).put("payload",payload);
        byte[] h=m.toString().getBytes(StandardCharsets.UTF_8);if(h.length>MAX_HEADER)throw new Exception("LIMIT");
        out.writeInt(h.length);out.write(h);out.writeInt(body.length);out.write(body);out.flush();
    }
    void send(String type,JSONObject payload)throws Exception{send(type,payload,new byte[0]);}
}
