package pl.broniarek.gardenmanager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;
@RunWith(AndroidJUnit4.class)
public class CameraFlowSetupTest {
    @Test public void prepareField() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            async(scenario,"await window.Capacitor.Plugins.GardenFiles.saveNavigation({address:'#field?field=field-today'});return 'ok'");
            evaluate(scenario,"location.hash='#field?field=field-today'");
            waitFor(scenario,"!!document.querySelector('.field-visit')");
            assertEquals("ok",async(scenario,"const result=await window.Capacitor.Plugins.GardenCamera.readPending();if(result.operation)throw Error('Unexpected pending operation');return 'ok'"));
        }
    }
}
