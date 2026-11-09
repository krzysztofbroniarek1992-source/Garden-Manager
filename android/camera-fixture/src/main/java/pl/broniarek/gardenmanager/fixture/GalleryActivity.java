package pl.broniarek.gardenmanager.fixture;
import android.content.*;
import android.net.Uri;
import androidx.core.content.FileProvider;
import java.io.*;
/** Exercises multiple content URIs and their temporary Android read grants. */
public class GalleryActivity extends CaptureActivity {
    @Override protected void confirm() {
        try {
            File dir=new File(getCacheDir(),"photos");dir.mkdirs();
            File photo=new File(dir,"photo.jpg");try(InputStream in=getAssets().open("photo.jpg");OutputStream out=new FileOutputStream(photo)) {in.transferTo(out);}
            Uri uri=FileProvider.getUriForFile(this,getPackageName()+".files",photo);
            ClipData clips=ClipData.newUri(getContentResolver(),"photos",uri);clips.addItem(new ClipData.Item(uri));
            Intent result=new Intent().setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);result.setClipData(clips);
            setResult(RESULT_OK,result);finish();
        } catch(Exception e) {throw new RuntimeException(e);}
    }
}
