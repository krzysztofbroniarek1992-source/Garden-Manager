package pl.broniarek.gardenmanager;
import org.junit.Test;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.Assert.*;
public class LanWireTest {
 private final String sid="12345678-1234-4123-8123-123456789abc";
 private byte[] frame(JSONObject h,int size,byte[] b)throws Exception{
  ByteArrayOutputStream out=new ByteArrayOutputStream();DataOutputStream d=new DataOutputStream(out);
  byte[] header=h.toString().getBytes(StandardCharsets.UTF_8);d.writeInt(header.length);d.write(header);d.writeInt(size);d.write(b);return out.toByteArray();
 }
 private JSONObject header(int seq)throws Exception{return new JSONObject().put("v",1).put("type","hello").put("id",UUID.randomUUID().toString()).put("seq",seq).put("sid",sid).put("payload",new JSONObject());}
 private LanWire reader(byte[] b){return new LanWire(new ByteArrayInputStream(b),new ByteArrayOutputStream(),sid);}
 @Test public void privateAddressesOnly()throws Exception{
  for(String ip:new String[]{"10.0.2.2","172.16.1.1","172.31.255.254","192.168.43.1"})assertTrue(LanWire.privateAddress(ip));
  for(String ip:new String[]{"127.0.0.1","8.8.8.8","172.32.0.1","192.168.01.1","localhost","10.2.3.999","::1"})assertFalse(LanWire.privateAddress(ip));
 }
 @Test public void exactSchemaAndTypes()throws Exception{
  assertThrows(Exception.class,()->LanWire.fields(new JSONObject().put("unexpected",true)));
  assertThrows(Exception.class,()->LanWire.integer(new JSONObject().put("v","1"),"v"));
  assertThrows(Exception.class,()->LanWire.integer(new JSONObject().put("v",1.5),"v"));
  assertThrows(Exception.class,()->LanWire.name("Bad\nname"));
 }
 @Test public void syntheticFixturesAndHashes()throws Exception{
  for(int size:new int[]{1024,102400,1048576,10485760})for(String kind:new String[]{"json","binary"}){
   byte[] b=LanWire.synthetic(size,kind);assertEquals(size,b.length);assertEquals(64,LanWire.sha(b).length());
   assertArrayEquals(b,LanWire.synthetic(size,kind));if(kind.equals("json"))assertEquals("gm011a-synthetic",new JSONObject(new String(b,StandardCharsets.UTF_8)).getString("kind"));
  }
  assertThrows(Exception.class,()->LanWire.options(999,"json"));
 }
 @Test public void rejectsVersionUnknownTypeAndUnexpectedFields()throws Exception{
  for(String kind:new String[]{"version","type","field"}){
   JSONObject h=header(0);if(kind.equals("version"))h.put("v",2);if(kind.equals("type"))h.put("type","execute");if(kind.equals("field"))h.put("extra",true);
   assertThrows(Exception.class,()->reader(frame(h,0,new byte[0])).receive());
  }
 }
 @Test public void replayedIdAndWrongSessionRejected()throws Exception{
  JSONObject h=header(0);ByteArrayOutputStream b=new ByteArrayOutputStream();b.write(frame(h,0,new byte[0]));h.put("seq",1);b.write(frame(h,0,new byte[0]));
  LanWire w=reader(b.toByteArray());w.receive();assertThrows(Exception.class,w::receive);
  assertThrows(Exception.class,()->reader(frame(header(0).put("sid",UUID.randomUUID().toString()),0,new byte[0])).receive());
 }
 @Test public void oversizedHeaderAndBodyRejectedBeforeAllocation()throws Exception{
  ByteArrayOutputStream b=new ByteArrayOutputStream();new DataOutputStream(b).writeInt(8193);
  assertThrows(Exception.class,()->reader(b.toByteArray()).receive());
  assertThrows(Exception.class,()->reader(frame(header(0),10485761,new byte[0])).receive());
 }
 @Test public void interruptedFrameRejected()throws Exception{
  assertThrows(Exception.class,()->reader(new byte[]{0,0}).receive());
  assertThrows(Exception.class,()->reader(frame(header(0),1024,new byte[10])).receive((h,n)->true));
 }
 @Test public void invalidUtf8Rejected()throws Exception{
  assertThrows(Exception.class,()->reader(new byte[]{0,0,0,2,(byte)0xc3,0x28,0,0,0,0}).receive());
 }
}
