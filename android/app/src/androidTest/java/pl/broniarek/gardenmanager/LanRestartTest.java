package pl.broniarek.gardenmanager;
import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;
/** Invoked separately after am force-stop: this is a real app process restart. */
@RunWith(AndroidJUnit4.class)
public class LanRestartTest {
 @Test public void nativeIdentityTrustAndBusinessDataSurviveForceStop()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  java.io.File file=new java.io.File(context.getFilesDir(),"gm011a-persistence-test.json");
  JSONObject expected=new JSONObject(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));
  try(ActivityScenario<MainActivity> s=ActivityScenario.launch(MainActivity.class)){
   ready(s);evaluate(s,"location.hash='#sync'");waitFor(s,"!!document.querySelector('.lan-page')");
   JSONObject actual=new JSONObject(async(s,"return JSON.stringify(await window.Capacitor.Plugins.GardenLan.command({action:'status'}))"));
   assertFalse("Session cannot auto-start",actual.getBoolean("active"));
   for(String key:new String[]{"id","name","fingerprint"})assertEquals(expected.getJSONObject("device").getString(key),actual.getJSONObject("device").getString(key));
   assertEquals(expected.getJSONArray("peers").toString(),actual.getJSONArray("peers").toString());
   assertEquals(expected.getString("businessSha256"),LanWire.sha(async(s,READ_STATE+"return JSON.stringify(state)").getBytes(StandardCharsets.UTF_8)));
  }finally{file.delete();}
 }
}
