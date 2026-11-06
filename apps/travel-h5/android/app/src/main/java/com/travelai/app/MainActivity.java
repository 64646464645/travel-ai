package com.travelai.app;

import android.os.Bundle;
import android.os.SystemClock;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        long startAt = SystemClock.elapsedRealtime();
        // 必须在 super.onCreate 之前注册，桥接初始化时才会加载该插件。
        registerPlugin(WebViewMetricsPlugin.class);
        super.onCreate(savedInstanceState);
        WebViewMetricsPlugin.markInitCost(SystemClock.elapsedRealtime() - startAt);
        // 桥接创建完成后再挂页面监听，否则会被 Bridge.Builder 的列表替换覆盖。
        WebViewMetricsPlugin.attachPageListeners(getBridge());
    }
}
