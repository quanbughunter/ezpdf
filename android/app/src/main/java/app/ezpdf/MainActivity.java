package app.ezpdf;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ezPDF's own plugin (open/save through the Storage Access Framework,
        // PDFs opened with or shared to the app) must be known before the bridge starts.
        registerPlugin(EzFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
