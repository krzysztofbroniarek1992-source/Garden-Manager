package pl.broniarek.gardenmanager;
import android.app.AlertDialog;
import android.app.Activity;
import android.content.Intent;
import android.graphics.*;
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
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;

@CapacitorPlugin(name="GardenLan")
public class GardenLanPlugin extends Plugin {
    private LanEngine engine;private final ExecutorService commands=Executors.newFixedThreadPool(2);
    private File qrFile;private String qrPending;
    @Override public void load(){engine=new LanEngine(getContext());}
    private void exact(PluginCall call,String...keys)throws Exception{LanWire.fields(call.getData(),keys);}
    private String text(PluginCall call,String name,int max)throws Exception{
        Object v=call.getData().get(name);if(!(v instanceof String)||((String)v).length()>max)throw new Exception("PROTOCOL");return (String)v;
    }
    @PluginMethod public void command(PluginCall call){
        commands.execute(()->{
            String action="";
            try {
                action=text(call,"action",20);
                switch(action){
                    case "status":exact(call,"action");break;
                    case "start":exact(call,"action","address");engine.start();break;
                    case "stop":exact(call,"action");engine.stop();break;
                    case "rename":exact(call,"action","name");engine.rename(text(call,"name",80));break;
                    case "pair":exact(call,"action","invitation");engine.pair(text(call,"invitation",8192));break;
                    case "connect":exact(call,"action","id","host","port");engine.connect(text(call,"id",80),text(call,"host",32),LanWire.integer(call.getData(),"port"));break;
                    case "forget":exact(call,"action","id");engine.forget(text(call,"id",80));break;
                    case "test":exact(call,"action","bytes","kind");engine.test(LanWire.integer(call.getData(),"bytes"),text(call,"kind",10));break;
                    case "confirm":
                        exact(call,"action");JSONObject pending=engine.view().optJSONObject("pending");
                        if(pending==null)throw new Exception("PAIRING");
                        getActivity().runOnUiThread(()->new AlertDialog.Builder(getActivity())
                            .setTitle("Potwierdź tożsamość komputera")
                            .setMessage("Porównaj na obu ekranach kod: "+pending.optString("code")+"\n"+pending.optString("name")+"\nSHA256: "+pending.optString("fingerprint")+"\nZaufaj tylko zgodnemu urządzeniu.")
                            .setNegativeButton("Anuluj",(d,w)->call.reject("Anulowano potwierdzenie."))
                            .setPositiveButton("Zaufaj",(d,w)->commands.execute(()->{try{engine.confirm();call.resolve(JSObject.fromJSONObject(engine.view()));}catch(Exception e){call.reject(LanEngine.message(e));}}))
                            .setOnCancelListener(d->call.reject("Anulowano potwierdzenie.")).show());
                        return;
                    case "scan":exact(call,"action");capture(call);return;
                    default:throw new Exception("PROTOCOL");
                }
                call.resolve(JSObject.fromJSONObject(engine.view()));
            }catch(Exception e){if(action.equals("pair")||action.equals("connect"))engine.stop();call.reject(LanEngine.message(e));}
        });
    }
    private void capture(PluginCall call)throws Exception{
        if(qrPending!=null)throw new Exception("BUSY");
        File folder=new File(getContext().getCacheDir(),"lan-qr");if(!folder.exists()&&!folder.mkdirs())throw new Exception("CAMERA");
        qrFile=File.createTempFile("invitation-",".jpg",folder);qrPending=call.getCallbackId();
        Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".lan.qr",qrFile);
        Intent intent=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        getActivity().runOnUiThread(()->{
            try{startActivityForResult(call,intent,"qrResult");}
            catch(Exception e){cleanupQr();call.reject("Nie można uruchomić aparatu. Możesz wkleić zaproszenie z Windows.");}
        });
    }
    @ActivityCallback private void qrResult(PluginCall call,ActivityResult result){
        commands.execute(()->{
            try{
                if(call==null)return;
                if(result.getResultCode()!=Activity.RESULT_OK){call.resolve(JSObject.fromJSONObject(engine.view()));return;}
                if(qrFile==null||qrFile.length()>8*1024*1024||qrFile.length()==0)throw new Exception("QR");
                BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(qrFile.getPath(),bounds);
                if(bounds.outWidth<=0||bounds.outHeight<=0||bounds.outWidth>20000||bounds.outHeight>20000)throw new Exception("QR");
                BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;
                while(Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;
                Bitmap bitmap=BitmapFactory.decodeFile(qrFile.getPath(),options);if(bitmap==null)throw new Exception("QR");
                String text;
                try {
                    int width=bitmap.getWidth(),height=bitmap.getHeight();int[] pixels=new int[width*height];bitmap.getPixels(pixels,0,width,0,0,width,height);
                    Map<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.POSSIBLE_FORMATS,Arrays.asList(BarcodeFormat.QR_CODE));hints.put(DecodeHintType.TRY_HARDER,true);
                    text=new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width,height,pixels))),hints).getText();
                }finally{bitmap.recycle();}
                if(!text.startsWith("GM011A:")||text.length()>8192)throw new Exception("QR");
                call.resolve(JSObject.fromJSONObject(engine.view().put("scannedInvitation",text)));
            }catch(Exception e){if(call!=null)call.reject("Nie odczytano kodu Garden Manager. Zbliż aparat do kodu lub wklej zaproszenie ręcznie.");}
            finally{cleanupQr();}
        });
    }
    private void cleanupQr(){if(qrFile!=null)qrFile.delete();qrFile=null;qrPending=null;}
    @Override protected void handleOnPause(){if(engine!=null)engine.stop();super.handleOnPause();}
    @Override protected void handleOnDestroy(){if(engine!=null)engine.destroy();commands.shutdownNow();super.handleOnDestroy();}
}
