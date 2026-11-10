package pl.broniarek.gardenmanager;

import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.*;
import java.util.Scanner;
import static org.junit.Assert.*;
import static pl.broniarek.gardenmanager.WebViewTestSupport.*;

/** Seed and verify are deliberately run as separate instrumentation processes around adb install -r. */
@RunWith(AndroidJUnit4.class)
public class UpgradeDataTest {
    private Context target(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
    @Test public void seedBeforeUpdate() throws Exception {
        String fixture;
        try(Scanner input=new Scanner(InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("upgrade-data.json"),"UTF-8")) {
            fixture=input.useDelimiter("\\A").next();
        }
        JSONObject definitions=new JSONObject(fixture);
        for(String key:new String[]{"clients","gardens","jobs","payments","taskSchedules","taskOccurrences","availability","notes","todos","checklists","workTemplates","materialCatalog"})
            assertTrue("Upgrade fixture must exercise non-empty "+key,definitions.getJSONArray(key).length()>0);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            String expected=async(scenario,"return navigator.locks.request('garden-manager-photos',async()=>{"+READ_STATE+"const d=JSON.parse("+JSONObject.quote(fixture)+");"+"""
                for(const key of ['expenses','expenseCategories','expenseRules','expenseProfiles','expenseImports'])delete d[key];
                d.clients[0].name='GM009 upgrade preserved';
                const running=d.jobs.find(j=>j.id==='field-today');
                running.status='in-progress';d.timer={jobId:running.id,startedAt:Date.now()-12600000,paused:false};
                const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
                const image=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg'));
                const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await image.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
                const p={id:'gm009-photo',assetId:'gm009-asset',filename:'native.jpg',clientId:d.clients[0].id,gardenId:d.gardens[0].id,zoneId:null,jobId:null,clientName:d.clients[0].name,gardenName:d.gardens[0].name,zoneName:null,jobTitle:null,category:'before',description:'Upgrade fixture',capturedDate:null,addedAt:Date.now(),updatedAt:Date.now(),deletedAt:null,revision:1,mimeType:'image/jpeg',width:16,height:16,thumbnailWidth:16,thumbnailHeight:16,size:image.size,thumbnailSize:image.size,sha256:digest,thumbnailSha256:digest};
                d.photos.push(p);
                const photoDB=await new Promise((ok,no)=>{const r=indexedDB.open('garden-manager-photos',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
                await new Promise((ok,no)=>{const t=photoDB.transaction('assets','readwrite');t.objectStore('assets').put({id:p.assetId,image,thumbnail:image,createdAt:Date.now()});t.oncomplete=ok;t.onabort=()=>no(t.error)});
                const main=await new Promise(ok=>{const r=indexedDB.open('garden-manager-state',1);r.onsuccess=()=>ok(r.result)});
                await new Promise((ok,no)=>{const t=main.transaction('state','readwrite');t.objectStore('state').put({...state,revision:state.revision+1,data:d},'current');t.oncomplete=ok;t.onabort=()=>no(t.error)});main.close();
                const seeded=await new Promise((ok,no)=>{const r=photoDB.transaction('assets').objectStore('assets').get(p.assetId);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});photoDB.close();
                if(!seeded?.image || seeded.image.size!==image.size) throw Error('Photo fixture must exist before upgrade');
                return JSON.stringify(d);
                });
                """);
            assertTrue(target().getSharedPreferences("gm009-device-test",Context.MODE_PRIVATE).edit().putString("expected",expected).commit());
        }
    }
    @Test public void verifyAfterUpdate() throws Exception {
        String expected=target().getSharedPreferences("gm009-device-test",Context.MODE_PRIVATE).getString("expected",null);
        assertNotNull("Run seedBeforeUpdate on APK A before installing B",expected);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            String actual=async(scenario,READ_STATE+"""
                if(state.formatVersion!==11)throw Error('Expected migrated v11');
                if(state.data.expenses.length || state.data.expenseImports.length || !state.data.expenseCategories.length || !state.data.expenseRules.length)throw Error('Expense migration defaults');
                const d=structuredClone(state.data);
                for(const key of ['expenses','expenseCategories','expenseRules','expenseProfiles','expenseImports'])delete d[key];
                const db=await new Promise(ok=>{const r=indexedDB.open('garden-manager-state',1);r.onsuccess=()=>ok(r.result)});
                const backup=await new Promise(ok=>{const r=db.transaction('state').objectStore('state').get('format-v10-source');r.onsuccess=()=>ok(r.result)});db.close();
                if(backup?.formatVersion!==10 || JSON.stringify(backup.data)!==JSON.stringify(d))throw Error('Exact pre-migration v10 backup missing');
                return JSON.stringify(d);
                """);
            assertEquals(new JSONObject(expected).toString(),new JSONObject(actual).toString());
            assertEquals("ok",async(scenario,READ_STATE+"""
                if(!state.data.timer || state.data.timer.paused || Date.now()-state.data.timer.startedAt<12600000) throw Error('Timer was stopped or reset');
                const p=state.data.photos.find(p=>p.id==='gm009-photo');
                const dbp=await new Promise(ok=>{const r=indexedDB.open('garden-manager-photos',1);r.onsuccess=()=>ok(r.result)});
                const asset=await new Promise(ok=>{const r=dbp.transaction('assets').objectStore('assets').get(p.assetId);r.onsuccess=()=>ok(r.result)});dbp.close();
                for(const blob of [asset.image,asset.thumbnail]) {const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==p.sha256)throw Error('Photo changed');}
                return 'ok';
                """));
        }
    }
}
