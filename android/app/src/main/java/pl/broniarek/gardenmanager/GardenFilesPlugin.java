package pl.broniarek.gardenmanager;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.util.concurrent.*;

@CapacitorPlugin(name="GardenFiles")
public class GardenFilesPlugin extends Plugin {
    @PluginMethod public void readNavigation(PluginCall call) {
        JSObject result=new JSObject();
        result.put("address",getContext().getSharedPreferences("navigation-ui",Context.MODE_PRIVATE).getString("address",""));
        call.resolve(result);
    }
    @PluginMethod public void saveNavigation(PluginCall call) {
        String address=call.getString("address","");
        if(!address.startsWith("#") || address.length()>16000 || address.chars().anyMatch(c->c<32)) {
            call.reject("Nieprawidłowy adres widoku.");return;
        }
        getContext().getSharedPreferences("navigation-ui",Context.MODE_PRIVATE).edit().putString("address",address).apply();
        call.resolve();
    }
    @PluginMethod public void releasePhoto(PluginCall call) {
        work(call,()->{
            Uri uri=Uri.parse(call.getString("uri",""));
            if(!"file".equals(uri.getScheme()) || uri.getPath()==null) {call.resolve();return;}
            File file=new File(uri.getPath()).getCanonicalFile();
            String cache=getContext().getCacheDir().getCanonicalPath()+File.separator;
            File pictures=getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES);
            boolean own=file.getPath().startsWith(cache) && !file.getPath().startsWith(cache+"garden-exports"+File.separator);
            own=own || (pictures!=null && file.getPath().startsWith(pictures.getCanonicalPath()+File.separator));
            if(own && file.isFile() && file.getName().toLowerCase(java.util.Locale.ROOT).matches(".*\\.(jpg|jpeg|png|webp)")) file.delete();
            call.resolve();
        });
    }
    private final java.util.concurrent.atomic.AtomicBoolean pickerActive=new java.util.concurrent.atomic.AtomicBoolean();
    private FileStageStore stages;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    @Override public void load() {
        try {
            stages=new FileStageStore(new File(getContext().getCacheDir(),"garden-exports"));
            cleanupCameraCache(getContext().getCacheDir());
            cleanupCameraCache(getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES));
        }
        catch(IOException ignored) { /* Every call reports the failure; no data fallback. */ }
    }
    private void cleanupCameraCache(File directory) {
        if(directory==null) return;
        File[] files=directory.listFiles();
        if(files!=null) for(File file:files)
            if(file.isFile() && file.lastModified()<System.currentTimeMillis()-48L*60*60*1000
                && file.getName().toLowerCase(java.util.Locale.ROOT).matches(".*\\.(jpg|jpeg|png|webp)")) file.delete();
    }
    private void work(PluginCall call, Work action) {
        io.execute(()->{
            try {
                if(stages==null) throw new IOException("Brak dostępu do pamięci plików. Zwolnij miejsce i uruchom aplikację ponownie.");
                action.run();
            } catch(Exception e) { call.reject(e.getMessage(), e); }
        });
    }
    private interface Work { void run() throws Exception; }
    @PluginMethod public void begin(PluginCall call) { work(call,()->{
        String token=stages.begin(call.getString("name","garden-manager"),call.getString("mime",""),call.getInt("size",-1).longValue());
        JSObject out=new JSObject();out.put("token",token);call.resolve(out);
    }); }
    @PluginMethod public void append(PluginCall call) { work(call,()->{
        String encoded=call.getString("base64","");
        if(encoded.length()>350000) throw new IOException("Fragment pliku jest zbyt duży.");
        stages.append(call.getString("token"),call.getInt("offset",-1).longValue(),Base64.decode(encoded,Base64.DEFAULT));call.resolve();
    }); }
    @PluginMethod public void discard(PluginCall call) { work(call,()->{stages.discard(call.getString("token"));call.resolve();}); }
    @PluginMethod public void finish(PluginCall call) { work(call,()->{
        FileStageStore.Stage stage=stages.complete(call.getString("token"));
        getActivity().runOnUiThread(()->{
            try {
                String action=call.getString("action","");
                if(action.equals("save")) {
                    if(!pickerActive.compareAndSet(false,true)) {call.reject("Trwa wybór innego pliku. Poczekaj na jego zakończenie.");return;}
                    Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(stage.mime).putExtra(Intent.EXTRA_TITLE,stage.file.getName());
                    startActivityForResult(call,intent,"saved");return;
                }
                Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".garden.files",stage.file);
                Intent intent;
                if(action.equals("share")) {
                    intent=new Intent(Intent.ACTION_SEND).setType(stage.mime).putExtra(Intent.EXTRA_STREAM,uri);
                    intent.setClipData(ClipData.newRawUri(stage.file.getName(),uri));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent=Intent.createChooser(intent,"Udostępnij plik Garden Manager");
                } else if(action.equals("open") && stage.mime.equals("application/pdf")) {
                    intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,stage.mime);
                    intent.setClipData(ClipData.newRawUri(stage.file.getName(),uri));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else throw new IOException("Nieobsługiwana operacja pliku.");
                getActivity().startActivity(intent); call.resolve();
            } catch(ActivityNotFoundException e) { if("save".equals(call.getString("action"))) pickerActive.set(false); call.reject("Brak aplikacji do otwarcia lub udostępnienia pliku. Zapisz plik i zainstaluj czytnik PDF.",e); }
            catch(Exception e) { if("save".equals(call.getString("action"))) pickerActive.set(false); call.reject(e.getMessage(),e); }
        });
    }); }
    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        pickerActive.set(false);
        if(call==null) return;
        if(result.getResultCode()!=Activity.RESULT_OK) { cancelled(call);return; }
        work(call,()->{
            Uri uri=result.getData()==null?null:result.getData().getData();
            if(uri==null) throw new IOException("Android nie zwrócił miejsca zapisu.");
            FileStageStore.Stage stage=stages.complete(call.getString("token"));
            try(InputStream in=new FileInputStream(stage.file); OutputStream out=getContext().getContentResolver().openOutputStream(uri,"wt")) {
                if(out==null) throw new IOException("Brak dostępu do wybranego miejsca zapisu.");
                byte[] buffer=new byte[192*1024];int n;while((n=in.read(buffer))!=-1) out.write(buffer,0,n);out.flush();
            } catch(Exception e) {
                // Best effort removal of a newly created, incomplete export, never source data.
                try { android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(),uri); } catch(Exception ignored) {}
                throw e;
            }
            call.resolve();
        });
    }
    @PluginMethod public void pickBackup(PluginCall call) {
        if(!pickerActive.compareAndSet(false,true)) {call.reject("Trwa wybór innego pliku. Poczekaj na jego zakończenie.");return;}
        getActivity().runOnUiThread(()->{
            try {
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivityForResult(call,intent,"picked");
            } catch(Exception e) {pickerActive.set(false);call.reject("Nie udało się otworzyć wyboru kopii ZIP.",e);}
        });
    }
    @ActivityCallback private void picked(PluginCall call, ActivityResult result) {
        pickerActive.set(false);
        if(call==null) return;
        if(result.getResultCode()!=Activity.RESULT_OK) {cancelled(call);return;}
        work(call,()->{
            Uri uri=result.getData()==null?null:result.getData().getData();
            if(uri==null) throw new IOException("Nie wybrano pliku.");
            // The selected file may have unknown length. Copy with a hard limit before validation.
            File temporary=File.createTempFile("gm-import-",".zip",getContext().getCacheDir());
            String token=null;
            try {
                long total=0;
                try(InputStream in=getContext().getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(temporary)) {
                    if(in==null) throw new IOException("Nie udało się odczytać kopii.");
                    byte[] buffer=new byte[192*1024];int n;
                    while((n=in.read(buffer))!=-1) {total+=n;if(total>FileStageStore.LIMIT) throw new IOException("Kopia przekracza limit 200 MB.");out.write(buffer,0,n);}
                }
                token=stages.begin("kopia.zip","application/zip",total);
                try(InputStream in=new FileInputStream(temporary)) {
                    byte[] buffer=new byte[192*1024];int n;long offset=0;
                    while((n=in.read(buffer))!=-1) {stages.append(token,offset,java.util.Arrays.copyOf(buffer,n));offset+=n;}
                }
                FileStageStore.Stage stage=stages.complete(token);
                JSObject out=new JSObject();out.put("token",token);out.put("uri",Uri.fromFile(stage.file).toString());out.put("name","kopia.zip");call.resolve(out);
            } catch(Exception e) {if(token!=null) stages.discard(token);throw e;}
            finally {temporary.delete();}
        });
    }
    private void cancelled(PluginCall call) {JSObject out=new JSObject();out.put("cancelled",true);call.resolve(out);}
    @Override protected void handleOnDestroy() {io.shutdown();}
}
