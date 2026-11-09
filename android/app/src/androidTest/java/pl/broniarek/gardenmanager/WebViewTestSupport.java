package pl.broniarek.gardenmanager;

import androidx.test.core.app.ActivityScenario;
import java.util.concurrent.*;
import org.json.*;
import static org.junit.Assert.*;

final class WebViewTestSupport {
    static Object evaluate(ActivityScenario<MainActivity> scenario,String expression) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);String[] result=new String[1];
        scenario.onActivity(a->a.getBridge().getWebView().evaluateJavascript(expression,value->{result[0]=value;latch.countDown();}));
        assertTrue("WebView callback timed out",latch.await(10,TimeUnit.SECONDS));
        return new JSONTokener(result[0]).nextValue();
    }
    static void waitFor(ActivityScenario<MainActivity> scenario,String expression) throws Exception {
        long until=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<until) {
            if(Boolean.TRUE.equals(evaluate(scenario,expression))) return;
            Thread.sleep(100);
        }
        fail("WebView condition timed out: "+expression);
    }
    static void ready(ActivityScenario<MainActivity> scenario) throws Exception {
        waitFor(scenario,"!!document.querySelector('.app-shell') && !!window.Capacitor.Plugins.GardenFiles");
    }
    static String async(ActivityScenario<MainActivity> scenario,String body) throws Exception {
        evaluate(scenario,"window.__gmNativeTest=null;(async()=>{"+body+"})().then(value=>window.__gmNativeTest={value},error=>window.__gmNativeTest={error:String(error)})");
        waitFor(scenario,"window.__gmNativeTest!==null");
        JSONObject result=new JSONObject((String)evaluate(scenario,"JSON.stringify(window.__gmNativeTest)"));
        assertFalse(result.optString("error"),result.has("error"));
        return result.optString("value");
    }
    static final String READ_STATE="const db=await new Promise((ok,no)=>{const r=indexedDB.open('garden-manager-state',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});const state=await new Promise((ok,no)=>{const t=db.transaction('state');const r=t.objectStore('state').get('current');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});db.close();";
}
