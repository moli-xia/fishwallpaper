// 碧池观鱼 · the pond with all its controls, full screen: feeding, naming koi, weather, sound, settings.
// It is the live wallpaper's settings screen too (see PondWallpaperService); on first launch it offers the
// system's live-wallpaper preview, so the pond goes straight onto the home screen. Changes made here reach the
// wallpaper as they are saved.
package com.bichi.koipond;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {
    private static final int POND = PondWeb.POND;
    private FrameLayout root;
    private WebView web;
    private int[] insets = new int[4]; // cutout insets in CSS px: top, right, bottom, left

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(POND));
        // Let the pond run under a notch or punch-hole camera; the page keeps its controls clear of it.
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(POND);
        if (Build.VERSION.SDK_INT >= 28) {
            root.setOnApplyWindowInsetsListener((v, in) -> {
                DisplayCutout cut = in.getDisplayCutout();
                float d = getResources().getDisplayMetrics().density;
                insets = cut == null ? new int[4] : new int[] {
                        Math.round(cut.getSafeInsetTop() / d), Math.round(cut.getSafeInsetRight() / d),
                        Math.round(cut.getSafeInsetBottom() / d), Math.round(cut.getSafeInsetLeft() / d) };
                pushInsets();
                return in;
            });
        }
        setContentView(root);
        createWebView();
        // First launch: go straight to the system preview that sets the pond as the live wallpaper.
        android.content.SharedPreferences prefs = getSharedPreferences("pond", MODE_PRIVATE);
        if (savedInstanceState == null && !prefs.getBoolean("offeredWallpaper", false) && !PondWeb.isOurWallpaper(this)) {
            prefs.edit().putBoolean("offeredWallpaper", true).apply();
            PondWeb.openWallpaperPicker(this);
        }
    }

    private void createWebView() {
        web = PondWeb.create(this, null, new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) { pushInsets(); }

            // Links in the page (the weather service credit) open in the phone's browser, not over the pond.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith("file:")) return false;
                try { startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) { }
                return true;
            }

            // If the system reclaims the WebView's renderer (low memory, GPU reset), build a fresh one instead of crashing.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view);
                PondWeb.destroy(view);
                createWebView();
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // Hand the cutout insets to the page as CSS variables (WebView does not always report env(safe-area-inset-*)).
    private void pushInsets() {
        if (web == null) return;
        // Insets can arrive before the page exists; onPageFinished pushes them again.
        web.evaluateJavascript("(function(e){if(!e)return;var s=e.style;s.setProperty('--safe-top','" + insets[0] + "px');s.setProperty('--safe-right','" + insets[1]
                + "px');s.setProperty('--safe-bottom','" + insets[2] + "px');s.setProperty('--safe-left','" + insets[3]
                + "px');})(document.documentElement)", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    // Out of sight the pond stops drawing and its sounds fall silent; it picks up where it was on return.
    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.evaluateJavascript("window.pondControl&&pondControl.pause(true);typeof persist==='function'&&persist()", null);
            web.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.pondControl&&pondControl.pause(false)", null);
        }
        hideSystemUi();
    }

    // Back closes an open panel or leaves immersive viewing first; only then does it send the pond to the background.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) { moveTaskToBack(true); return; }
        web.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return 1;}"
                + "if(document.body.classList.contains('zen')&&typeof setZen==='function'){setZen(false);return 1;}return 0;})()",
                result -> { if (!"1".equals(result)) moveTaskToBack(true); });
    }

    @Override
    protected void onDestroy() {
        PondWeb.destroy(web);
        web = null;
        super.onDestroy();
    }
}
