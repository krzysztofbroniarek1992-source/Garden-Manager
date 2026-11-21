package pl.broniarek.gardenmanager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;

/** Production offline WebView, React forms and canonical transactions, with actual
 * Android Back and native dirty-draft confirmation. No direct shopping writes. */
@RunWith(AndroidJUnit4.class)
public class ShoppingTest {
    private void click(ActivityScenario<MainActivity> s,String name)throws Exception {
        evaluate(s,"(()=>{const name="+org.json.JSONObject.quote(name)+";const row=Array.from(document.querySelectorAll('article[aria-label]')).find(e=>e.getAttribute('aria-label')==='Zakup: Sekator Android GM010A');const root=row&&['Edytuj zakup','Oznacz jako zamówione','Odebrano — kupione','Dodaj do wydatków firmowych','Archiwizuj zakup'].includes(name)?row:document;const b=Array.from(root.querySelectorAll('button')).find(b=>b.textContent.trim()==="+org.json.JSONObject.quote(name)+");if(!b)throw Error('Button missing');b.click()})()");
    }
    private void set(ActivityScenario<MainActivity> s,String label,String value)throws Exception {
        evaluate(s,"(()=>{const e=Array.from(document.querySelectorAll('label')).find(e=>e.childNodes[0]?.textContent.trim()==="+org.json.JSONObject.quote(label)+").querySelector('input,textarea');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+org.json.JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    }
    @Test public void shoppingOfflineExpenseAndBackSurviveReopen()throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            String before=async(scenario,READ_STATE+"return JSON.stringify([state.data.jobs,state.data.payments,state.data.timer])");
            int originalCosts=Integer.parseInt(async(scenario,READ_STATE+"return String(state.data.expenses.length)"));
            click(scenario,"Więcej");
            waitFor(scenario,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Lista zakupów')");
            click(scenario,"Lista zakupów");
            waitFor(scenario,"!!document.querySelector('.shopping-page')");
            set(scenario,"Szybko dodaj produkt","Sekator Android GM010A");
            click(scenario,"Dodaj produkt");
            waitFor(scenario,"document.querySelector('.shopping-list')?.textContent.includes('Sekator Android GM010A')");
            click(scenario,"Edytuj zakup");
            waitFor(scenario,"!!document.querySelector('[role=dialog] form')");
            set(scenario,"Notatki","Nie zgub szkicu Android");
            assertEquals("painted",async(scenario,"await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));return 'painted'"));
            scenario.onActivity(a->((android.view.inputmethod.InputMethodManager)a.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(a.getWindow().getDecorView().getWindowToken(),0));
            scenario.onActivity(a->a.getOnBackPressedDispatcher().onBackPressed());
            UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            UiObject2 cancel=device.wait(Until.findObject(By.res("android","button2")),20000);
            assertNotNull("Shopping unsaved Back confirmation",cancel);cancel.click();
            waitFor(scenario,"!!document.querySelector('[role=dialog] textarea') && document.querySelector('[role=dialog] textarea').value==='Nie zgub szkicu Android'");
            click(scenario,"Zapisz zakup");
            waitFor(scenario,"!document.querySelector('[role=dialog]')");
            click(scenario,"Oznacz jako zamówione");
            waitFor(scenario,"document.querySelector('.shopping-list')?.textContent.includes('Zamówione')");
            click(scenario,"Odebrano — kupione");
            waitFor(scenario,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Dodaj do wydatków firmowych')");
            assertEquals(originalCosts,Integer.parseInt(async(scenario,READ_STATE+"return String(state.data.expenses.length)")));
            click(scenario,"Dodaj do wydatków firmowych");
            waitFor(scenario,"!!document.querySelector('[role=dialog] form')");
            set(scenario,"Kwota (zł)","25,50");set(scenario,"Data wydatku","2026-11-10");
            evaluate(scenario,"(()=>{const e=Array.from(document.querySelectorAll('[role=dialog] label')).find(e=>e.childNodes[0]?.textContent.trim()==='Kategoria').querySelector('select');e.value='expense-category-1';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
            click(scenario,"Zapisz wydatek");
            waitFor(scenario,"!document.querySelector('[role=dialog]') && document.querySelector('.shopping-list')?.textContent.includes('Powiązany wydatek')");
            click(scenario,"Archiwizuj zakup");
            waitFor(scenario,"!Array.from(document.querySelectorAll('article[aria-label]')).some(e=>e.getAttribute('aria-label')==='Zakup: Sekator Android GM010A')");
            assertEquals(before,async(scenario,READ_STATE+"return JSON.stringify([state.data.jobs,state.data.payments,state.data.timer])"));
            scenario.recreate();ready(scenario);
            assertEquals("ok",async(scenario,READ_STATE+"const p=state.data.shoppingItems.find(p=>p.name==='Sekator Android GM010A');const e=state.data.expenses.find(e=>e.id===p?.expenseId);if(state.formatVersion!==12||!p?.archivedAt||p.notes!=='Nie zgub szkicu Android'||e?.amountCents!==2550||state.data.expenses.length!=="+(originalCosts+1)+")throw Error('Shopping reopen');return 'ok'"));
            evaluate(scenario,"location.hash='#shopping'");
            waitFor(scenario,"!!document.querySelector('.shopping-page')");
            click(scenario,"Archiwum kupionych");
            waitFor(scenario,"document.querySelector('.shopping-list')?.textContent.includes('Sekator Android GM010A')");
        }
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            assertEquals("purchased",async(scenario,READ_STATE+"return state.data.shoppingItems.find(p=>p.name==='Sekator Android GM010A').status"));
        }
    }
}
