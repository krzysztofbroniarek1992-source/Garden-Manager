package pl.broniarek.gardenmanager;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;

/** Real packaged offline WebView; MediaStore CSV fixture exercises the production system
 * picker, bounded native staging, CSV parser and wizard. */
@RunWith(AndroidJUnit4.class)
public class ExpensesTest {
    @Test public void offlineExpensesImportBackAndReopen() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            String before=async(scenario,READ_STATE+"return JSON.stringify([state.data.jobs,state.data.payments,state.data.timer])");
            evaluate(scenario,"location.hash='#expenses'");
            waitFor(scenario,"!!document.querySelector('.expenses-page')");
            evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Dodaj wydatek').click()");
            waitFor(scenario,"!!document.querySelector('[role=dialog] form')");
            evaluate(scenario,"""
                const set=(label,value)=>{const e=Array.from(document.querySelectorAll('[role=dialog] label')).find(e=>e.textContent.trim().startsWith(label)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));};
                set('Kontrahent','GM009B urządzenie');set('Kwota (zł)','12,34');document.activeElement?.blur();
                """);
            assertEquals("painted",async(scenario,"await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));return 'painted'"));
            scenario.onActivity(a->((android.view.inputmethod.InputMethodManager)a.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(a.getWindow().getDecorView().getWindowToken(),0));
            scenario.onActivity(a->a.getOnBackPressedDispatcher().onBackPressed());
            UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            UiObject2 cancel=device.wait(Until.findObject(By.res("android","button2")),20000);
            assertNotNull("Unsaved expense confirmation",cancel);cancel.click();
            waitFor(scenario,"!!document.querySelector('[role=dialog] form')");
            evaluate(scenario,"document.querySelector('[role=dialog] form').requestSubmit()");
            waitFor(scenario,"!document.querySelector('[role=dialog]') && document.querySelector('.expense-ledger').textContent.includes('GM009B urządzenie')");
            evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Importuj CSV').click()");
            waitFor(scenario,"!!document.querySelector('.expense-import')");
            evaluate(scenario,"""
                const name=Array.from(document.querySelectorAll('label')).find(e=>e.textContent.trim().startsWith('Nazwa profilu rachunku')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'Konto GM009B');name.dispatchEvent(new Event('input',{bubbles:true}));
                """);
            // Native UI intentionally exposes a system picker instead of a hidden web
            // input. Cancel it and verify no data was posted just by selecting a file.
            evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Wybierz CSV z urządzenia').click()");
            assertTrue("System document picker",device.wait(Until.hasObject(By.pkg("com.google.android.documentsui")),20000));
            device.pressBack();
            waitFor(scenario,"!!document.querySelector('.expense-import') && !document.querySelector('.expense-import [role=status]')");
            android.content.ContentValues values=new android.content.ContentValues();
            values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME,"gm009b-bank.csv");
            values.put(android.provider.MediaStore.Downloads.MIME_TYPE,"text/csv");
            values.put(android.provider.MediaStore.Downloads.RELATIVE_PATH,android.os.Environment.DIRECTORY_DOWNLOADS);
            android.content.ContentResolver resolver=InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
            android.net.Uri csv=resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
            assertNotNull(csv);
            try {
                try(java.io.OutputStream output=resolver.openOutputStream(csv)) {output.write("Data;Kwota;Opis\n10.11.2026;-20,00;Serwis\n10.11.2026;100,00;Wpłata".getBytes(java.nio.charset.StandardCharsets.UTF_8));}
                evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Wybierz CSV z urządzenia').click()");
                UiObject2 document=device.wait(Until.findObject(By.text("gm009b-bank.csv")),15000);
                if(document==null) {
                    UiObject2 roots=device.findObject(By.desc("Show roots"));
                    if(roots==null)roots=device.findObject(By.desc("Open navigation drawer"));
                    assertNotNull("Document roots drawer",roots);roots.click();
                    UiObject2 downloads=device.wait(Until.findObject(By.text("Downloads")),10000);assertNotNull(downloads);downloads.click();
                    document=device.wait(Until.findObject(By.text("gm009b-bank.csv")),15000);
                }
                assertNotNull("CSV document visible in system picker",document);document.click();
                waitFor(scenario,"document.querySelector('.expense-import')?.textContent.includes('Przypisz kolumny')");
                evaluate(scenario,"""
                    for(const [name,value] of [['Data','0'],['Kwota ze znakiem','1'],['Opis','2']]) {
                        const label=Array.from(document.querySelectorAll('.expense-import label')).find(e=>e.childNodes[0]?.textContent.trim()===name);
                        const select=label.querySelector('select');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
                    }
                    """);
                evaluate(scenario,"document.querySelector('.expense-import').requestSubmit()");
                waitFor(scenario,"document.querySelector('.expense-counts')?.textContent.includes('Nowe: 2')");
                evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Zatwierdź nowe obciążenia bez ostrzeżeń').click()");
                evaluate(scenario,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Zapisz import (')).click()");
                UiObject2 accept=device.wait(Until.findObject(By.res("android","button1")),20000);assertNotNull("Import confirmation",accept);accept.click();
                waitFor(scenario,"!document.querySelector('[role=dialog]') && document.querySelectorAll('.expense-ledger .tool-card').length===3");
            } finally {resolver.delete(csv,null,null);}
            assertEquals(before,async(scenario,READ_STATE+"return JSON.stringify([state.data.jobs,state.data.payments,state.data.timer])"));
            scenario.recreate();ready(scenario);
            assertEquals("ok",async(scenario,READ_STATE+"if(state.formatVersion!==11 || !state.data.expenses.some(e=>e.counterparty==='GM009B urządzenie'&&e.amountCents===1234) || state.data.expenseImports.length!==1 || state.data.expenses.filter(e=>e.direction==='incoming').some(e=>e.status!=='excluded'))throw Error('Expense reopen');return 'ok'"));
        }
    }
}
