package pl.broniarek.gardenmanager;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GardenFilesPlugin.class);
        registerPlugin(GardenCameraPlugin.class);
        super.onCreate(savedInstanceState);
        // Android 15/16 enforces edge-to-edge. Keep both system bars and IME
        // outside the WebView so existing fixed toolbars/modal layouts stay usable.
        WindowCompat.setDecorFitsSystemWindows(getWindow(),false);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        // API 24/25 has white navigation icons only; give them a dark backdrop.
        getWindow().setNavigationBarColor(android.os.Build.VERSION.SDK_INT < 26 ? 0xff153e35 : android.graphics.Color.TRANSPARENT);
        View content=findViewById(android.R.id.content);
        content.setBackgroundColor(0xfff6f7f5);
        WindowCompat.getInsetsController(getWindow(),content).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(),content).setAppearanceLightNavigationBars(true);
        ViewCompat.setOnApplyWindowInsetsListener(content,(view,windowInsets)->{
            Insets bars=windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime=windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
