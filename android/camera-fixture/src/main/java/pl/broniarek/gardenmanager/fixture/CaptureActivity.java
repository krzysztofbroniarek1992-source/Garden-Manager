package pl.broniarek.gardenmanager.fixture;
import android.app.Activity;
import android.os.Bundle;
import android.content.*;
import android.net.Uri;
import android.provider.MediaStore;
import android.widget.*;
import java.io.*;
/** External camera stand-in writes an actual JPEG through the production output URI. */
public class CaptureActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(30,100,30,30);
        TextView label=new TextView(this);label.setText("External GM camera fixture");layout.addView(label);
        Button confirm=new Button(this);confirm.setText("CONFIRM GM PHOTO");layout.addView(confirm);confirm.setOnClickListener(v->confirm());
        Button cancel=new Button(this);cancel.setText("CANCEL GM PHOTO");layout.addView(cancel);cancel.setOnClickListener(v->{setResult(RESULT_CANCELED);finish();});
        setContentView(layout);
    }
    protected void confirm() {
        try {
            Uri uri=getIntent().getParcelableExtra(MediaStore.EXTRA_OUTPUT);
            try(InputStream in=getAssets().open("photo.jpg");OutputStream out=getContentResolver().openOutputStream(uri)) {in.transferTo(out);}
            setResult(RESULT_OK);finish();
        } catch(Exception e) {throw new RuntimeException(e);}
    }
}
