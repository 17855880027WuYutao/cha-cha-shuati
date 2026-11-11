package com.chacha.quiz;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends Activity {

    private static final int REQ_FILE = 1001;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 状态栏 / 导航栏用页面同色（米黄），图标深色
        getWindow().setStatusBarColor(Color.parseColor("#F7F5F0"));
        getWindow().setNavigationBarColor(Color.parseColor("#F7F5F0"));
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.parseColor("#F7F5F0")));
        View decor = getWindow().getDecorView();
        int ui = decor.getSystemUiVisibility()
                | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(ui);

        web = new WebView(this);
        web.setBackgroundColor(0xFFF7F5F0);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "application/msword",
                        "application/octet-stream"
                });
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择题库文件"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        setContentView(web);

        String html = readAsset("app.html");
        // 注入两件事：振动补偿 + localStorage 改走 SharedPreferences（WebView 存储不稳）
        String shim = "<script>(function(){"
                + "try{"
                + "var real=null,ok=false;try{real=window.localStorage;real.setItem('__t','1');real.removeItem('__t');ok=true;}catch(e){ok=false;}"
                + "if(window.AndroidBridge&&typeof AndroidBridge.lsGet==='function'){"
                + "var store={getItem:function(k){try{var v=AndroidBridge.lsGet(k);return v===null?null:String(v);}catch(e){return ok?real.getItem(k):null;}},"
                + "setItem:function(k,v){try{AndroidBridge.lsSet(k,String(v));}catch(e){if(ok){try{real.setItem(k,v);}catch(_){}}}},"
                + "removeItem:function(k){try{AndroidBridge.lsDel(k);}catch(e){if(ok){try{real.removeItem(k);}catch(_){}}}},"
                + "clear:function(){try{AndroidBridge.lsClear();}catch(e){}},"
                + "key:function(){return null;},get length(){return 0;}};"
                + "try{Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return store;}});}catch(e){}"
                + "}"
                + "if(!navigator.vibrate){try{Object.defineProperty(navigator,'vibrate',{configurable:true,value:function(p){"
                + "var ms=Array.isArray(p)?p[p.length-1]:p; try{AndroidBridge.vibrate(ms||20);}catch(e){} return true;}});}catch(e){}}"
                + "}catch(e){}"
                + "})();</script></head>";
        html = html.replace("</head>", shim);
        web.loadDataWithBaseURL("https://quiz.local/", html, "text/html", "UTF-8", null);
    }

    public class Bridge {
        private android.content.SharedPreferences prefs() {
            return getSharedPreferences("quiz_store", MODE_PRIVATE);
        }

        @JavascriptInterface
        public String lsGet(String key) {
            try { return prefs().getString(key, null); } catch (Exception e) { return null; }
        }

        @JavascriptInterface
        public void lsSet(String key, String value) {
            try { prefs().edit().putString(key, value).apply(); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void lsDel(String key) {
            try { prefs().edit().remove(key).apply(); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void lsClear() {
            try { prefs().edit().clear().apply(); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) v.vibrate(Math.max(1, Math.min(300, ms)));
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString("UTF-8");
        } catch (Exception e) {
            return "<html><body style='font-family:sans-serif;padding:24px'>页面加载失败：" + e + "</body></html>";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            Uri[] out = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                out = new Uri[] { data.getData() };
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(out);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
