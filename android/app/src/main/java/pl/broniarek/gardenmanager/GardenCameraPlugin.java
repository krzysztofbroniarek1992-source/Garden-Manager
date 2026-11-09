package pl.broniarek.gardenmanager;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Only an expiring, unconfirmed acquisition. Photos still go to the existing IndexedDB service. */
@CapacitorPlugin(name="GardenCamera")
public class GardenCameraPlugin extends Plugin {
    static final long TTL = 24L * 60 * 60 * 1000;
    static final long MAX_FILE = 25L * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    @Override protected void handleOnDestroy() { io.shutdown(); super.handleOnDestroy(); }
    private String message(Exception error) {
        if(error instanceof SecurityException) return "Brak uprawnienia do aparatu lub wybranych zdjęć. Sprawdź ustawienia Androida.";
        if(error instanceof ActivityNotFoundException) return "Brak aplikacji aparatu lub wyboru zdjęć na tym urządzeniu.";
        String raw=error.getMessage()==null?"":error.getMessage();
        if(raw.matches("(?is).*(ENOSPC|EDQUOT|no space|disk full|quota).*$")) return "Brak miejsca na zdjęcie. Zwolnij pamięć urządzenia i spróbuj ponownie.";
        return raw.isEmpty()?"Nie udało się odczytać zdjęcia.":raw;
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences("pending-photo-operation", Context.MODE_PRIVATE); }
    private File root() { return new File(getContext().getFilesDir(), "pending-media"); }
    private File directory(String id) throws IOException {
        if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Nieprawidłowy identyfikator wyboru zdjęć.");
        return new File(root(), id);
    }
    private void remove(File file) { File[] children=file.listFiles(); if(children!=null) for(File child:children) remove(child); file.delete(); }
    private JSObject current() throws Exception {
        String raw=prefs().getString("operation", null);
        JSObject op=raw==null ? null : new JSObject(raw);
        if(op!=null && (System.currentTimeMillis()-op.getLong("startedAt")>TTL || op.getLong("startedAt")>System.currentTimeMillis()+60000)) {
            clear(op.getString("id")); op=null;
        }
        // A crash before persisting an operation must not leave unbounded temporary files.
        File[] dirs=root().listFiles();
        if(dirs!=null) for(File dir:dirs) if(dir.lastModified()<System.currentTimeMillis()-TTL && (op==null || !dir.getName().equals(op.getString("id")))) remove(dir);
        return op;
    }
    private void persist(JSObject op) throws IOException {
        if(!prefs().edit().putString("operation",op.toString()).commit()) throw new IOException("Nie można zachować kontekstu zdjęcia. Sprawdź wolne miejsce.");
    }
    private void clear(String id) throws Exception {
        if(!prefs().edit().remove("operation").commit()) throw new IOException("Nie można zakończyć wyboru zdjęcia.");
        Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".garden.files",new File(directory(id),"capture.jpg"));
        getContext().revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        remove(directory(id));
    }
    private interface Work { void run() throws Exception; }
    private void work(PluginCall call, Work action) { io.execute(()->{try{action.run();}catch(Exception e){call.reject(e.getMessage(),e);}}); }
    @PluginMethod public void readPending(PluginCall call) { work(call,()->{JSObject out=new JSObject();out.put("operation",current());call.resolve(out);}); }
    @PluginMethod public void acknowledge(PluginCall call) { work(call,()->{
        JSObject op=current(); if(op!=null && op.getString("id").equals(call.getString("id"))) clear(op.getString("id")); call.resolve();
    }); }
    @PluginMethod public void acquire(PluginCall call) { work(call,()->{
        if(current()!=null) throw new IOException("Najpierw zapisz lub anuluj poprzednio wybrane zdjęcia.");
        JSObject requested=call.getObject("operation");
        if(requested==null || requested.toString().length()>4000) throw new IOException("Brak kontekstu zdjęcia.");
        String id=requested.getString("id"), source=requested.getString("source");
        directory(id);
        if(!source.equals("camera") && !source.equals("gallery")) throw new IOException("Nieprawidłowe źródło zdjęcia.");
        JSObject op=new JSObject(requested.toString()); op.put("startedAt",System.currentTimeMillis());op.put("status","launching");
        File dir=directory(id); if(!dir.mkdirs() && !dir.isDirectory()) throw new IOException("Brak miejsca na zdjęcie.");
        persist(op);
        getActivity().runOnUiThread(()->{
            try {
                Intent intent;
                if(source.equals("camera")) {
                    Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".garden.files",new File(dir,"capture.jpg"));
                    intent=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    intent.setClipData(ClipData.newRawUri("photo",uri));
                } else intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivityForResult(call,intent,"selected");
            } catch(Exception e) { finishFailure(call,id,message(e)); }
        });
    }); }
    private void finishFailure(PluginCall call,String id,String message) {
        work(call,()->{
            JSObject op=current(); if(op==null || !id.equals(op.getString("id"))) throw new IOException("Wybór zdjęć wygasł.");
            op.put("status","error");op.put("message",message==null?"Nie udało się otworzyć aparatu lub galerii.":message);persist(op);call.resolve(op);
        });
    }
    @ActivityCallback private void selected(PluginCall call, ActivityResult result) {
        if(call==null) return;
        work(call,()->{
            JSObject requested=call.getObject("operation");
            JSObject op=current();
            if(op==null || requested==null || !op.getString("id").equals(requested.getString("id"))) {call.reject("Wybór zdjęć wygasł. Nie dodano zdjęć.");return;}
            if(!op.getString("status").equals("launching")) {call.resolve(op);return;}
            File dir=directory(op.getString("id"));
            try {
                if(result.getResultCode()!=Activity.RESULT_OK) op.put("status","cancelled");
                else {
                    JSArray files=new JSArray();
                    if(op.getString("source").equals("camera")) {
                        Uri output=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".garden.files",new File(dir,"capture.jpg"));
                        getContext().revokeUriPermission(output,Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        files.put(describe(new File(dir,"capture.jpg"),"image/jpeg"));
                    } else {
                        Intent data=result.getData(); List<Uri> uris=new ArrayList<>();
                        if(data!=null && data.getClipData()!=null) {for(int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());}
                        else if(data!=null && data.getData()!=null) uris.add(data.getData());
                        if(uris.isEmpty() || uris.size()>20) throw new IOException("Wybierz od 1 do 20 zdjęć.");
                        for(Uri uri:uris) {
                            if(!"content".equals(uri.getScheme())) throw new IOException("Nieprawidłowy adres zdjęcia.");
                            String mime=getContext().getContentResolver().getType(uri);
                            if(!Arrays.asList("image/jpeg","image/png","image/webp").contains(mime)) throw new IOException("Wybierz JPEG, PNG lub WebP.");
                            File file=new File(dir,"selected-"+files.length());
                            try(InputStream in=getContext().getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(file)) {
                                if(in==null) throw new IOException("Brak dostępu do zdjęcia.");
                                byte[] buffer=new byte[65536];long count=0;int n;
                                while((n=in.read(buffer))!=-1) {count+=n;if(count>MAX_FILE) throw new IOException("Zdjęcie przekracza limit 25 MB.");out.write(buffer,0,n);}
                            }
                            files.put(describe(file,mime));
                        }
                    }
                    op.put("files",files);op.put("status","ready");
                }
            } catch(Exception e) {op.put("status","error");op.put("message",message(e));}
            // Persist BEFORE delivering to either a live promise or a restored bridge.
            persist(op);call.resolve(op);
        });
    }
    private JSObject describe(File file,String mime) throws Exception {
        if(!file.isFile() || file.length()==0) throw new IOException("Aparat nie zwrócił zdjęcia.");
        if(file.length()>MAX_FILE) throw new IOException("Zdjęcie przekracza limit 25 MB.");
        JSObject out=new JSObject();out.put("uri",Uri.fromFile(file).toString());out.put("name",mime.equals("image/png")?"zdjecie.png":mime.equals("image/webp")?"zdjecie.webp":"zdjecie.jpg");out.put("mime",mime);out.put("size",file.length());return out;
    }
}
