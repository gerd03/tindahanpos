package com.simplepos.sukitrack;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DownloadsBackupPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
