package com.travelai.app;

import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.SystemClock;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 采集当前 WebView 内核信息与启动/加载耗时。
 * 只读观测，不修改页面内容，不引入任何第三方 APM，也不上报数据。
 */
@CapacitorPlugin(name = "WebViewMetrics")
public class WebViewMetricsPlugin extends Plugin {

    private static volatile long initCostMs = -1L;
    private static volatile long pageStartAt = -1L;
    private static volatile long pageLoadedAt = -1L;
    private static boolean listenerAttached = false;

    /** 由 MainActivity 在 super.onCreate 之后写入，记录 Activity 创建到 WebView 就绪的耗时。 */
    static void markInitCost(long costMs) {
        if (initCostMs < 0L) {
            initCostMs = costMs;
        }
    }

    /**
     * 必须在 Bridge 创建完成之后调用。
     * Bridge.Builder 创建桥接的最后会用自身列表整体替换 bridge 的监听器列表
     * （Bridge.setWebViewListeners），因此写在 Plugin.load() 里的监听会被覆盖掉。
     */
    static void attachPageListeners(Bridge bridge) {
        if (bridge == null || listenerAttached) {
            return;
        }
        listenerAttached = true;

        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageStarted(WebView webView) {
                    pageStartAt = SystemClock.elapsedRealtime();
                    pageLoadedAt = -1L;
                }

                @Override
                public void onPageLoaded(WebView webView) {
                    pageLoadedAt = SystemClock.elapsedRealtime();
                }
            }
        );
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();

        String providerPackage = "";
        String providerVersion = "";

        // WebView.getCurrentWebViewPackage 自 API 26 起可用；更低版本不做推断。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info != null) {
                if (info.packageName != null) {
                    providerPackage = info.packageName;
                }
                if (info.versionName != null) {
                    providerVersion = info.versionName;
                }
            }
        }

        ret.put("providerPackage", providerPackage);
        ret.put("providerVersion", providerVersion);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        ret.put("initCostMs", initCostMs);
        ret.put(
            "pageLoadMs",
            (pageStartAt > 0L && pageLoadedAt >= pageStartAt) ? (pageLoadedAt - pageStartAt) : -1L
        );

        call.resolve(ret);
    }
}
