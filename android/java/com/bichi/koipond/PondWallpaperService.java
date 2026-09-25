// 碧池观鱼 · the pond as the phone's live wallpaper, behind the home screen (and the lock screen, where the system allows).
// A WallpaperService only hands us a Surface, and a WebView cannot draw into one directly; so the Surface backs a
// private virtual display, and the pond page runs in a Presentation window on that display — rendered by the GPU,
// WebGL and all, straight into the wallpaper.
package com.bichi.koipond;

import android.app.Presentation;
import android.app.WallpaperManager;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Bundle;
import android.os.SystemClock;
import android.service.wallpaper.WallpaperService;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class PondWallpaperService extends WallpaperService {
    @Override
    public Engine onCreateEngine() { return new PondEngine(); }

    final class PondEngine extends Engine {
        private VirtualDisplay display;
        private Presentation presentation;
        private FrameLayout frame;
        private WebView web;
        private boolean visible;
        // Tap detection from raw touches, for launchers that do not report taps on empty space themselves.
        private float downX, downY;
        private long downAt, lastTap;

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(true);
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
            super.onSurfaceChanged(holder, format, width, height);
            int dpi = getResources().getDisplayMetrics().densityDpi;
            if (display == null) {
                DisplayManager dm = (DisplayManager) getSystemService(DISPLAY_SERVICE);
                // No public flag: the display is private to this app, so its Presentation needs no special permission.
                display = dm.createVirtualDisplay("BichiPondWallpaper", width, height, dpi, holder.getSurface(), 0);
                presentation = new Presentation(PondWallpaperService.this, display.getDisplay());
                frame = new FrameLayout(presentation.getContext());
                frame.setBackgroundColor(PondWeb.POND);
                presentation.setContentView(frame);
                presentation.show();
                attachWeb();
            } else {
                display.setSurface(holder.getSurface());
                display.resize(width, height, dpi);
            }
        }

        private void attachWeb() {
            web = PondWeb.create(presentation.getContext(), "wallpaper", new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) { applyVisibility(); }

                // If the system reclaims the renderer, build the pond again rather than leave the wallpaper blank.
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    frame.removeView(view);
                    PondWeb.destroy(view);
                    web = null;
                    attachWeb();
                    return true;
                }
            });
            frame.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        // Only draw while the home or lock screen actually shows the wallpaper.
        @Override
        public void onVisibilityChanged(boolean visible) {
            this.visible = visible;
            applyVisibility();
        }

        private void applyVisibility() {
            if (web == null) return;
            if (visible) {
                web.onResume();
                web.evaluateJavascript("window.pondControl&&pondControl.pause(false)", null);
            } else {
                web.evaluateJavascript("window.pondControl&&pondControl.pause(true)", null);
                web.onPause();
            }
        }

        // A tap on empty home-screen space: the launcher reports it, and the koi come for food.
        @Override
        public Bundle onCommand(String action, int x, int y, int z, Bundle extras, boolean resultRequested) {
            if (WallpaperManager.COMMAND_TAP.equals(action)) tap(x, y);
            return null;
        }

        @Override
        public void onTouchEvent(MotionEvent e) {
            float slop = 12 * getResources().getDisplayMetrics().density;
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) { downX = e.getX(); downY = e.getY(); downAt = e.getEventTime(); }
            else if (e.getActionMasked() == MotionEvent.ACTION_UP && e.getEventTime() - downAt < 300
                    && Math.abs(e.getX() - downX) < slop && Math.abs(e.getY() - downY) < slop) tap(e.getX(), e.getY());
        }

        // Launchers that report taps also deliver the raw touch; whichever arrives first wins.
        private void tap(float x, float y) {
            long now = SystemClock.uptimeMillis();
            if (web == null || now - lastTap < 350) return;
            lastTap = now;
            float d = getResources().getDisplayMetrics().density;
            web.evaluateJavascript("window.pondTap&&pondTap(" + x / d + "," + y / d + ")", null);
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            release();
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onDestroy() {
            release();
            super.onDestroy();
        }

        private void release() {
            if (web != null) { web.evaluateJavascript("typeof persist==='function'&&persist()", null); PondWeb.destroy(web); web = null; }
            if (presentation != null) { presentation.dismiss(); presentation = null; }
            if (display != null) { display.release(); display = null; }
            frame = null;
        }
    }
}
