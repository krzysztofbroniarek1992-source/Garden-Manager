package pl.broniarek.gardenmanager;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import androidx.test.espresso.NoMatchingViewException;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.action.ViewActions.click;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;

/** Real WebView/bridge test. Run with airplane mode/network disabled by the device script. */
@RunWith(AndroidJUnit4.class)
public class NativeSmokeTest {
    private void clickDialogButton(int id) throws Exception {
        long until=System.currentTimeMillis()+10000;
        // The JS/native bridge delivers Back asynchronously; Espresso's UI queue
        // being idle does not mean the WebView has opened its JS confirm yet.
        while(true) {
            try {onView(withId(id)).perform(click());return;}
            catch(NoMatchingViewException error) {
                if(System.currentTimeMillis()>=until) throw error;
                Thread.sleep(100);
            }
        }
    }
    @Test public void packagedOfflineAppAndNativeBridge() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            assertEquals("https://localhost",evaluate(scenario,"location.origin"));
            assertEquals("android",evaluate(scenario,"window.Capacitor.getPlatform()"));
            assertEquals("0",async(scenario,"return String((await navigator.serviceWorker.getRegistrations()).length)"));
            for(String page:new String[]{"dashboard","clients","gardens","jobs","calendar","history","materials","calculators","notes","todos","templates","field"}) {
                evaluate(scenario,"location.hash='#"+page+"'");
                waitFor(scenario,"!!document.querySelector('main') && location.hash.startsWith('#"+page+"')");
            }
            assertEquals("ok",async(scenario,"const p=window.Capacitor.Plugins.GardenFiles;const s=await p.begin({name:'native.json',mime:'application/json',size:3});await p.append({token:s.token,offset:0,base64:btoa('123')});await p.discard({token:s.token});return 'ok'"));
            // The same production renderer/fonts are loaded from packaged files, offline.
            evaluate(scenario,"location.hash='#history?report=job-5'");
            waitFor(scenario,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Przygotuj podgląd raportu')");
            evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Przygotuj podgląd raportu').click()");
            waitFor(scenario,"!!document.querySelector('.report-paper') && !document.querySelector('html[aria-busy=true]')");
            assertFalse((Boolean)evaluate(scenario,"!!document.querySelector('.report-builder [role=alert]')"));
            // Android Back goes through App plugin, closes the addressed report only.
            scenario.onActivity(a->a.getOnBackPressedDispatcher().onBackPressed());
            clickDialogButton(android.R.id.button2);
            waitFor(scenario,"!!document.querySelector('.report-paper')");
            scenario.onActivity(a->a.getOnBackPressedDispatcher().onBackPressed());
            clickDialogButton(android.R.id.button1);
            waitFor(scenario,"!document.querySelector('.report-paper')");
            scenario.recreate();ready(scenario);
            assertEquals("https://localhost",evaluate(scenario,"location.origin"));
        }
    }
}
