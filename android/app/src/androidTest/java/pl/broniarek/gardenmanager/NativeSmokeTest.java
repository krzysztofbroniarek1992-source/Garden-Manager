package pl.broniarek.gardenmanager;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.json.JSONObject;
import android.os.SystemClock;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

/** Real WebView/bridge test. Run with airplane mode/network disabled by the device script. */
@RunWith(AndroidJUnit4.class)
public class NativeSmokeTest {
    // Retained ece932f evidence: SYSTEM Pixel Launcher ANR covered the real
    // app confirmation. Never dismiss a Garden Manager ANR or fake a JS answer.
    static boolean knownLauncherAnr(String owner,String title,boolean closeAvailable) {
        return "android".equals(owner) && "Pixel Launcher isn't responding".equals(title) && closeAvailable;
    }
    @Test public void launcherAnrPolicyDoesNotDismissApplicationConfirmations() {
        assertTrue(knownLauncherAnr("android","Pixel Launcher isn't responding",true));
        assertFalse(knownLauncherAnr("android","Garden Manager isn't responding",true));
        assertFalse(knownLauncherAnr("pl.broniarek.gardenmanager","Pixel Launcher isn't responding",true));
        assertFalse(knownLauncherAnr("android","Pixel Launcher isn't responding",false));
        assertFalse(knownLauncherAnr("android","Masz niezapisane zmiany.",true));
    }
    private void clickDialogButton(int id) throws Exception {
        UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        String resource=id==android.R.id.button2?"button2":"button1";
        long deadline=SystemClock.uptimeMillis()+20000;
        boolean recoveredLauncher=false;
        UiObject2 button=null;
        while(SystemClock.uptimeMillis()<deadline) {
            UiObject2 title=device.findObject(By.res("android","alertTitle"));
            UiObject2 close=device.findObject(By.res("android","aerr_close"));
            if(title!=null && knownLauncherAnr(title.getApplicationPackage(),title.getText(),close!=null)) {
                assertFalse("Repeated launcher ANR: emulator is unhealthy",recoveredLauncher);
                System.out.println("CI emulator: closing only the confirmed foreign Pixel Launcher ANR");
                close.click();
                assertTrue("Launcher ANR did not close",device.wait(Until.gone(By.res("android","aerr_close")),5000));
                recoveredLauncher=true;
                continue; // Do not send Back again or confirm the application.
            }
            button=device.findObject(By.res("android",resource));
            if(button!=null)break;
            Thread.sleep(100);
        }
        assertNotNull("Native confirmation did not appear: "+resource,button);
        assertNotNull("Expected the genuine unsaved-changes confirmation",
            device.findObject(By.text("Masz niezapisane zmiany. Opuścić formularz bez zapisywania?")));
        button.click();
        assertTrue("Application confirmation did not close",device.wait(Until.gone(By.res("android",resource)),5000));
        device.waitForIdle();
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
            String reportJobId=async(scenario,READ_STATE+"const j=state.data.jobs.find(j=>j.status==='completed' && !(j.reports?.length) && (j.visitDetails?.publicWork?.trim() || j.activities.join('\\n').trim()));if(!j)throw Error('Fixture requires an unsaved completed report');return j.id;");
            evaluate(scenario,"location.hash='#history?report='+encodeURIComponent("+JSONObject.quote(reportJobId)+")");
            waitFor(scenario,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Przygotuj podgląd raportu')");
            evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Przygotuj podgląd raportu').click()");
            waitFor(scenario,"!!document.querySelector('.report-paper') && !document.querySelector('html[aria-busy=true]')");
            assertFalse((Boolean)evaluate(scenario,"!!document.querySelector('.report-builder [role=alert]')"));
            // Let WebView paint its committed preview and close IME before testing
            // application Back. An immediate dispatcher call can race the frame
            // or test the keyboard's Back handling instead of the guarded card.
            evaluate(scenario,"document.activeElement?.blur()");
            scenario.onActivity(a->((android.view.inputmethod.InputMethodManager)a.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(a.getWindow().getDecorView().getWindowToken(),0));
            assertEquals("painted",async(scenario,"await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));return 'painted'"));
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle();
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
