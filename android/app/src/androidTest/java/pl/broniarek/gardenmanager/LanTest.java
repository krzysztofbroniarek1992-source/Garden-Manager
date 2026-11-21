package pl.broniarek.gardenmanager;
import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.*;
import static org.junit.Assert.*;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;

/** Real packaged WebView, AndroidKeyStore and JSSE. The other peer uses the
 * production Electron transport implementation in a disposable Node CI process. */
@RunWith(AndroidJUnit4.class)
public class LanTest {
    private void click(ActivityScenario<MainActivity> s,String name)throws Exception{
        waitFor(s,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==="+JSONObject.quote(name)+"&&!b.disabled)");
        evaluate(s,"(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==="+JSONObject.quote(name)+");if(!b||b.disabled)throw Error('Button unavailable');b.click();})()");
    }
    private void set(ActivityScenario<MainActivity> s,String label,String value)throws Exception{
        evaluate(s,"(()=>{const e=Array.from(document.querySelectorAll('label')).find(e=>e.childNodes[0]?.textContent.trim()==="+JSONObject.quote(label)+").querySelector('input,select');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()");
    }
    private JSONObject view(ActivityScenario<MainActivity> s)throws Exception{
        return new JSONObject(async(s,"return JSON.stringify(await window.Capacitor.Plugins.GardenLan.command({action:'status'}))"));
    }
    private void until(ActivityScenario<MainActivity> s,java.util.function.Predicate<JSONObject> condition)throws Exception{
        long end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){if(condition.test(view(s)))return;Thread.sleep(150);}fail("Native LAN condition timed out (no invitation or key logged)");
    }
    private void pair(ActivityScenario<MainActivity> s,JSONObject peer)throws Exception{
        if(!view(s).getBoolean("active"))click(s,"Rozpocznij sesję");
        set(s,"Zaproszenie z Windows",peer.getString("invitation"));
        click(s,"Połącz i porównaj kody");until(s,v->v.has("pending"));
        JSONObject pending=view(s).getJSONObject("pending");assertEquals(peer.getJSONObject("device").getString("fingerprint"),pending.getString("fingerprint"));
        evaluate(s,"document.querySelector('.lan-check input').click()");
        click(s,"Potwierdź parowanie");
        UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        UiObject2 trust=device.wait(Until.findObject(By.text("Zaufaj")),20000);assertNotNull("Native identity confirmation",trust);trust.click();
        until(s,v->!v.has("pending")&&v.optJSONArray("peers").toString().contains(peer.optJSONObject("device").optString("id")));
    }
    private void connect(ActivityScenario<MainActivity> s,JSONObject p)throws Exception{
        set(s,"Sparowany komputer",p.getJSONObject("device").getString("id"));set(s,"Adres IPv4",p.getString("host"));set(s,"Port TLS",String.valueOf(p.getInt("port")));
        click(s,"Połącz ręcznie");String id=p.getJSONObject("device").getString("id");
        until(s,v->v.optJSONObject("connected")!=null&&v.optJSONObject("connected").optString("id").equals(id));
        // The fixture performs one server-initiated probe before the phone probes.
        until(s,v->v.optJSONObject("result")!=null&&v.optJSONObject("result").optBoolean("ok")&&v.optJSONObject("result").optString("peerId").equals(id));
    }
    @Test public void realKeystorePairingTwoComputersDuplexOfflineAndRestart()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject fixture=new JSONObject(new String(Files.readAllBytes(new java.io.File(context.getFilesDir(),"gm011a-test.json").toPath()),StandardCharsets.UTF_8));
        JSONArray servers=fixture.getJSONArray("servers");String id,fingerprint,before;
        try(ActivityScenario<MainActivity> s=ActivityScenario.launch(MainActivity.class)){
            ready(s);before=async(s,READ_STATE+"return JSON.stringify(state)");
            evaluate(s,"location.hash='#dashboard'");waitFor(s,"location.hash==='#dashboard' && !!document.querySelector('.dashboard-heading')");
            click(s,"Więcej");waitFor(s,"!!document.querySelector('.mobile-more-list')");click(s,"Synchronizacja");
            waitFor(s,"!!document.querySelector('.lan-page input')");
            JSONObject own=view(s).getJSONObject("device");id=own.getString("id");fingerprint=own.getString("fingerprint");
            KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
            assertNull("Signing key is not exportable",ks.getKey(LanIdentity.SIGNING,null).getEncoded());
            assertNull("Vault key is not exportable",ks.getKey(LanIdentity.VAULT,null).getEncoded());
            set(s,"Nazwa urządzenia","Telefon CI LAN");
            assertEquals("painted",async(s,"await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));return 'painted'"));
            s.onActivity(a->a.getOnBackPressedDispatcher().onBackPressed());
            UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            UiObject2 cancel=device.wait(Until.findObject(By.res("android","button2")),20000);assertNotNull("Dirty device name Back confirmation",cancel);cancel.click();
            click(s,"Zapisz nazwę urządzenia");until(s,v->v.optJSONObject("device").optString("name").equals("Telefon CI LAN"));
            pair(s,servers.getJSONObject(0));connect(s,servers.getJSONObject(0));
            for(int bytes:new int[]{1024,102400,1048576,10485760})for(String kind:new String[]{"json","binary"}){
                long previous=view(s).optJSONObject("result").optLong("at");
                set(s,"Rozmiar testu",String.valueOf(bytes));set(s,"Typ danych testowych",kind);click(s,"Testuj połączenie");
                until(s,v->v.optJSONObject("result")!=null&&v.optJSONObject("result").optLong("at")>previous&&v.optJSONObject("result").optInt("bytes")==bytes&&v.optJSONObject("result").optString("kind").equals(kind)&&!v.optBoolean("busy"));
                JSONObject result=view(s).getJSONObject("result");
                assertTrue(result.getBoolean("ok"));assertEquals(result.getString("sentSha256"),result.getString("receivedSha256"));
                System.out.println(new JSONObject().put("synthetic",true).put("platform","android-emulator").put("bytes",bytes).put("kind",kind).put("elapsedMs",result.getLong("elapsedMs")).put("sha256Matches",true));
            }
            click(s,"Zakończ sesję");until(s,v->!v.optBoolean("active"));
            click(s,"Rozpocznij sesję");
            JSONObject first=servers.getJSONObject(0),second=servers.getJSONObject(1);
            assertEquals("rejected",async(s,"try{await window.Capacitor.Plugins.GardenLan.command({action:'connect',id:"+JSONObject.quote(first.getJSONObject("device").getString("id"))+",host:"+JSONObject.quote(second.getString("host"))+",port:"+second.getInt("port")+"});return 'unexpected';}catch(e){return 'rejected';}"));
            assertEquals(1,view(s).getJSONArray("peers").length());
            pair(s,second);connect(s,second);assertEquals(2,view(s).getJSONArray("peers").length());
            assertEquals(before,async(s,READ_STATE+"return JSON.stringify(state)"));
            assertEquals(Boolean.TRUE,evaluate(s,"document.documentElement.scrollWidth<=innerWidth"));
            s.recreate();ready(s);evaluate(s,"location.hash='#sync'");waitFor(s,"!!document.querySelector('.lan-page')");
            assertEquals(id,view(s).getJSONObject("device").getString("id"));assertEquals(fingerprint,view(s).getJSONObject("device").getString("fingerprint"));
            assertEquals(2,view(s).getJSONArray("peers").length());assertFalse(view(s).getBoolean("active"));
            assertEquals(before,async(s,READ_STATE+"return JSON.stringify(state)"));
            evaluate(s,"location.hash='#dashboard'");waitFor(s,"!!document.querySelector('.dashboard-heading')");click(s,"Więcej");waitFor(s,"!!document.querySelector('.mobile-more-list')");click(s,"Synchronizacja");
            click(s,"Rozpocznij sesję");
            s.onActivity(a->a.getOnBackPressedDispatcher().onBackPressed());
            // Back returns through the shared history and unmount closes the native session.
            until(s,v->!v.optBoolean("active"));
        }finally{new java.io.File(context.getFilesDir(),"gm011a-test.json").delete();}
    }
}
