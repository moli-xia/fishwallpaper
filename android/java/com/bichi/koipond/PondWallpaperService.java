// 碧池观鱼 · the pond as the phone's live wallpaper, behind the home screen (and the lock screen, where the system allows).
// A WallpaperService only hands us a Surface, and a WebView cannot draw into one directly. The pond page runs in a
// Presentation window on a private virtual display, rendered by the GPU (WebGL and all).
//
// On Android 10 and later the virtual display renders into an ImageReader, and the engine copies each finished frame
// onto the wallpaper with lockHardwareCanvas — the ordinary way a wallpaper draws itself, which every phone supports.
// Letting the virtual display write straight into the wallpaper's surface works on stock Android but leaves it black on
// some manufacturers' systems. If no frame ever arrives (or the window cannot be shown), the wallpaper shows the pond
// painting instead of black, and says why in the app's settings.
package com.bichi.koipond;

import android.app.Presentation;
import android.app.WallpaperManager;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorSpace;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.hardware.HardwareBuffer;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.InputStream;

public class PondWallpaperService extends WallpaperService {
    static final String TAG = "BichiPond";

    @Override
    public Engine onCreateEngine() { return new PondEngine(); }

    /** What the wallpaper last reported about itself, shown in the app's settings. */
    static void setStatus(android.content.Context c, String status) {
        Log.i(TAG, "wallpaper: " + status);
        c.getSharedPreferences("pond", MODE_PRIVATE).edit().putString("wallpaperStatus", status).putLong("wallpaperStatusAt", System.currentTimeMillis()).apply();
    }

    final class PondEngine extends Engine {
        private final Handler main = new Handler(Looper.getMainLooper());
        private VirtualDisplay display;
        private Presentation presentation;
        private FrameLayout frame;
        private WebView web;
        private boolean visible;
        private int width, height;
        // Frame bridge (Android 10+): the virtual display renders here, a worker thread copies frames to the wallpaper.
        private ImageReader reader;
        private HandlerThread copier;
        private volatile SurfaceHolder target;
        private volatile boolean firstFrame, stillShown;
        private long frames;
        private final Paint copyPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
        // Tap detection from raw touches, for launchers that do not report taps on empty space themselves.
        private float downX, downY;
        private long downAt, lastTap;

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(true);
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int w, int h) {
            super.onSurfaceChanged(holder, format, w, h);
            int dpi = getResources().getDisplayMetrics().densityDpi;
            boolean resized = w != width || h != height;
            width = w; height = h; target = holder;
            if ("1".equals(sysProp("debug.bichi.still"))) { showStill("forced for testing (debug.bichi.still)"); return; }
            try {
                boolean bridge = Build.VERSION.SDK_INT >= 29 && !"1".equals(sysProp("debug.bichi.direct"));
                if (display == null) {
                    Surface out;
                    if (bridge) { startBridge(w, h); out = reader.getSurface(); } else out = holder.getSurface();
                    DisplayManager dm = (DisplayManager) getSystemService(DISPLAY_SERVICE);
                    // No public flag: the display is private to this app, so its Presentation needs no special permission.
                    display = dm.createVirtualDisplay("BichiPondWallpaper", w, h, dpi, out, 0);
                    presentation = new Presentation(PondWallpaperService.this, display.getDisplay());
                    // Some systems do not pass the app's hardware acceleration on to this window; WebView needs it.
                    presentation.getWindow().setFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED, WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
                    frame = new FrameLayout(presentation.getContext());
                    frame.setBackgroundColor(PondWeb.POND);
                    presentation.setContentView(frame);
                    presentation.show();
                    attachWeb();
                    setStatus(PondWallpaperService.this, (bridge ? "starting (frame bridge) " : "starting (direct) ") + w + "×" + h + " · Android " + Build.VERSION.RELEASE + " · " + Build.MANUFACTURER + " " + Build.MODEL);
                    // If the pond has not produced a single frame after a while, show the painting rather than black.
                    main.postDelayed(() -> { if (bridge && !firstFrame && display != null) showStill("no frames from the pond window after 10 s"); }, 10_000);
                } else if (resized) {
                    if (bridge && reader != null) { stopBridge(); startBridge(w, h); display.setSurface(reader.getSurface()); }
                    else if (!bridge) display.setSurface(holder.getSurface());
                    display.resize(w, h, dpi);
                }
            } catch (RuntimeException e) {
                // The window could not be shown here (a system restriction, most likely): the painting instead of black.
                Log.e(TAG, "pond window failed", e);
                releasePond();
                showStill(e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }

        // ---------- frame bridge ----------
        private void startBridge(int w, int h) {
            reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3,
                    HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_GPU_COLOR_OUTPUT);
            copier = new HandlerThread("BichiPondFrames");
            copier.start();
            reader.setOnImageAvailableListener(this::copyFrame, new Handler(copier.getLooper()));
        }

        private void stopBridge() {
            if (copier != null) { copier.quitSafely(); try { copier.join(500); } catch (InterruptedException ignored) { } copier = null; }
            if (reader != null) { reader.close(); reader = null; }
        }

        // Runs on the copier thread for every frame the pond renders.
        private void copyFrame(ImageReader r) {
            Image image;
            try { image = r.acquireLatestImage(); } catch (IllegalStateException e) { return; }
            if (image == null) return;
            try {
                SurfaceHolder holder = target;
                HardwareBuffer buffer = Build.VERSION.SDK_INT >= 29 ? image.getHardwareBuffer() : null;
                if (holder == null || buffer == null) return;
                Bitmap bitmap = Bitmap.wrapHardwareBuffer(buffer, ColorSpace.get(ColorSpace.Named.SRGB));
                buffer.close();
                if (bitmap == null) return;
                Canvas canvas = holder.lockHardwareCanvas();
                if (canvas == null) return;
                try { canvas.drawBitmap(bitmap, 0, 0, copyPaint); } finally { holder.unlockCanvasAndPost(canvas); }
                frames++;
                if (!firstFrame) {
                    firstFrame = true; stillShown = false;
                    setStatus(PondWallpaperService.this, "running · " + width + "×" + height + " · Android " + Build.VERSION.RELEASE + " · " + Build.MANUFACTURER + " " + Build.MODEL);
                }
            } catch (RuntimeException e) {
                Log.w(TAG, "frame copy failed", e);
            } finally {
                image.close();
            }
        }

        // ---------- the painting, when the live pond cannot run ----------
        private void showStill(String why) {
            setStatus(PondWallpaperService.this, "still painting shown — " + why + " · Android " + Build.VERSION.RELEASE + " · " + Build.MANUFACTURER + " " + Build.MODEL);
            stillShown = true;
            drawStill();
        }

        private void drawStill() {
            SurfaceHolder holder = target;
            if (holder == null || width == 0) return;
            Bitmap pond;
            try (InputStream in = getAssets().open("assets/pond.jpg")) { pond = BitmapFactory.decodeStream(in); } catch (Exception e) { return; }
            if (pond == null) return;
            // Fitted like the live pond: cover the screen, turned a quarter on a portrait screen so the lotus shows.
            boolean turn = height > width * 1.15f;
            float pw = turn ? pond.getHeight() : pond.getWidth(), ph = turn ? pond.getWidth() : pond.getHeight();
            float k = Math.max(width / pw, height / ph);
            Matrix m = new Matrix();
            m.postTranslate(-pond.getWidth() / 2f, -pond.getHeight() / 2f);
            if (turn) m.postRotate(90);
            m.postScale(k, k);
            m.postTranslate(width / 2f, height / 2f);
            Canvas canvas = null;
            try {
                canvas = Build.VERSION.SDK_INT >= 26 ? holder.lockHardwareCanvas() : holder.lockCanvas();
                if (canvas == null) return;
                canvas.drawColor(PondWeb.POND);
                canvas.drawBitmap(pond, m, copyPaint);
            } catch (RuntimeException e) {
                Log.w(TAG, "still painting failed", e);
            } finally {
                if (canvas != null) holder.unlockCanvasAndPost(canvas);
                pond.recycle();
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
            if (visible && stillShown) drawStill();
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
            target = null;
            releasePond();
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onDestroy() {
            target = null;
            releasePond();
            super.onDestroy();
        }

        private void releasePond() {
            main.removeCallbacksAndMessages(null);
            if (web != null) { PondWeb.destroy(web); web = null; }
            if (presentation != null) { try { presentation.dismiss(); } catch (RuntimeException ignored) { } presentation = null; }
            if (display != null) { display.release(); display = null; }
            stopBridge();
            frame = null;
            firstFrame = false;
        }
    }

    /** A system property, for testing on a device: debug.bichi.direct=1 renders straight into the wallpaper surface
     *  (the pre-1.2.1 way); debug.bichi.still=1 shows the still painting. */
    static String sysProp(String key) {
        try { return (String) Class.forName("android.os.SystemProperties").getMethod("get", String.class).invoke(null, key); }
        catch (Exception e) { return ""; }
    }
}
