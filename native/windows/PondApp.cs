// 碧池观鱼 · the Windows app: the pond as the desktop wallpaper on every screen, a tray icon to control it, and an
// interactive window. Every save one pond page makes is passed to the others, so they stay in step.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace BichiPond
{
    internal sealed class PondApp : ApplicationContext
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", RunName = "BichiKoiPond";
        private readonly List<WallpaperForm> walls = new List<WallpaperForm>();
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly Timer watch = new Timer { Interval = 1000 };
        private readonly ShellWatcher shell;
        private CoreWebView2Environment env;
        private InteractiveForm window;
        private bool userPaused, locked, rebuilding, quitting;
        private string weather = "sunny";
        private bool night;
        // Taps on the desktop, seen through a low-level mouse hook (the desktop icons layer takes the real clicks).
        private IntPtr hook;
        private Native.LowLevelMouseProc hookProc;
        private Native.POINT downAt;
        private uint downTime;

        public PondApp()
        {
            shell = new ShellWatcher(() => Rebuild(1500));
            BuildTray();
            watch.Tick += (s, e) => UpdateVisibility();
            SystemEvents.DisplaySettingsChanged += (s, e) => Rebuild(800);
            SystemEvents.SessionSwitch += (s, e) =>
            {
                if (e.Reason == SessionSwitchReason.SessionLock || e.Reason == SessionSwitchReason.ConsoleDisconnect || e.Reason == SessionSwitchReason.RemoteDisconnect) locked = true;
                if (e.Reason == SessionSwitchReason.SessionUnlock || e.Reason == SessionSwitchReason.ConsoleConnect || e.Reason == SessionSwitchReason.RemoteConnect) locked = false;
                UpdateVisibility();
            };
            // Start once the message loop runs, on the UI thread: every await below must come back to this thread,
            // where the windows are created (there is no WinForms synchronization context until a loop is running).
            var kickoff = new Timer { Interval = 1 };
            kickoff.Tick += async (s, e) =>
            {
                kickoff.Stop(); kickoff.Dispose();
                try { await Start(); }
                catch (Exception ex) { Report("启动失败", ex); Quit(); }
            };
            kickoff.Start();
        }

        private async Task Start()
        {
            string runtime = null;
            try { runtime = CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch (WebView2RuntimeNotFoundException) { }
            if (string.IsNullOrEmpty(runtime))
            {
                if (MessageBox.Show("碧池观鱼需要 Microsoft Edge WebView2 运行时（Windows 11 自带，Windows 10 多数已通过更新安装）。\n\n现在打开下载页面吗？", "碧池观鱼", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    PondPage.OpenInBrowser("https://developer.microsoft.com/microsoft-edge/webview2/");
                ExitThread();
                return;
            }
            string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BichiPond", "WebView2");
            env = await CoreWebView2Environment.CreateAsync(null, data);
            await BuildWallpapers();
            hookProc = OnMouse;
            hook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, hookProc, Native.GetModuleHandle(null), 0);
            watch.Start();
        }

        private async Task BuildWallpapers()
        {
            // After an Explorer restart these windows are already gone with the old desktop; just let them go.
            foreach (var w in walls) { try { w.Close(); w.Dispose(); } catch (Exception) { } }
            walls.Clear();
            if (!Desktop.Find()) return;
            foreach (var screen in Screen.AllScreens)
            {
                var wall = new WallpaperForm(screen);
                walls.Add(wall);
                await wall.Start(env, OnSave);
            }
            UpdateVisibility();
        }

        // Screens changed, or Explorer restarted and took the desktop layers (and our wallpapers) with it.
        private async void Rebuild(int delay)
        {
            if (rebuilding || env == null) return;
            rebuilding = true;
            await Task.Delay(delay);
            try { await BuildWallpapers(); }
            catch (Exception ex) { Report("桌面壁纸重建失败", ex); }
            finally { rebuilding = false; }
        }

        private IEnumerable<WebView2> Views => walls.Select(w => w.View).Concat(new[] { window?.View }).Where(v => v?.CoreWebView2 != null);

        // A page saved the pond: hand the same save to every other page, and note the weather for the menu.
        private void OnSave(WebView2 from, string json)
        {
            string call = "window.__pondSync&&__pondSync(" + PondPage.JsString(json) + ")";
            foreach (var v in Views) if (v != from) _ = v.CoreWebView2.ExecuteScriptAsync(call);
            var w = Regex.Match(json, "\"weather\":\"(\\w+)\"");
            if (w.Success) weather = w.Groups[1].Value;
            var n = Regex.Match(json, "\"night\":(true|false)");
            if (n.Success) night = n.Groups[1].Value == "true";
        }

        // A menu command goes to one page (the interactive window if open); its save carries the change to the others.
        private void Command(string options)
        {
            var target = window?.View?.CoreWebView2 != null ? window.View : walls.Select(w => w.View).FirstOrDefault(v => v?.CoreWebView2 != null);
            if (target != null) _ = target.CoreWebView2.ExecuteScriptAsync($"window.pondControl&&pondControl.set({options})");
        }

        private static void SetPaused(WallpaperForm wall, bool paused)
        {
            if (wall.View?.CoreWebView2 == null || wall.Paused == paused) return;
            wall.Paused = paused;
            _ = wall.View.CoreWebView2.ExecuteScriptAsync(paused ? "window.pondControl&&pondControl.pause(true)" : "window.pondControl&&pondControl.pause(false)");
        }

        // Each screen's pond rests while nobody can see it: a maximised or full-screen app over it, or the session locked.
        private void UpdateVisibility()
        {
            IntPtr fg = Native.GetForegroundWindow();
            IntPtr covering = IntPtr.Zero;
            if (fg != IntPtr.Zero && Native.IsWindowVisible(fg) && !IsShell(fg) && Native.GetWindowRect(fg, out var r))
            {
                var mi = new Native.MONITORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(Native.MONITORINFO)) };
                Native.GetMonitorInfo(Native.MonitorFromWindow(fg, Native.MONITOR_DEFAULTTONEAREST), ref mi);
                bool full = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
                if (full || Native.IsZoomed(fg)) covering = fg;
            }
            foreach (var w in walls)
            {
                bool coveredHere = covering != IntPtr.Zero && Screen.FromHandle(covering).DeviceName == w.Screen.DeviceName;
                w.SetHidden(locked || coveredHere);
                SetPaused(w, userPaused);
            }
        }

        private static bool IsShell(IntPtr hwnd)
        {
            string c = Native.ClassOf(hwnd);
            return c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "SysListView32";
        }

        // A click on the desktop itself (not on an app window) that did not move: the koi come for food there.
        // The desktop's icon layer gets the real click; the hook only watches and never swallows anything.
        private IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                var m = (Native.MSLLHOOKSTRUCT)System.Runtime.InteropServices.Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                int msg = wParam.ToInt32();
                if (msg == Native.WM_LBUTTONDOWN) { downAt = m.pt; downTime = m.time; }
                else if (msg == Native.WM_LBUTTONUP && m.time - downTime < 350 && Math.Abs(m.pt.X - downAt.X) < 6 && Math.Abs(m.pt.Y - downAt.Y) < 6)
                {
                    var pt = m.pt;
                    MainThread(() => TapIfDesktop(pt));
                }
            }
            return Native.CallNextHookEx(hook, code, wParam, lParam);
        }

        private void TapIfDesktop(Native.POINT pt)
        {
            IntPtr under = Native.WindowFromPoint(pt);
            string c = Native.ClassOf(under);
            bool desktop = c == "SysListView32" && Native.ClassOf(Native.GetParent(under)) == "SHELLDLL_DefView" || c == "SHELLDLL_DefView" || c == "WorkerW" || c == "Progman";
            if (!desktop) return;
            var p = new Point(pt.X, pt.Y);
            walls.FirstOrDefault(w => w.Screen.Bounds.Contains(p))?.Tap(p);
        }

        private void MainThread(Action a)
        {
            if (walls.Count > 0 && walls[0].IsHandleCreated) walls[0].BeginInvoke(a);
        }

        // Something went wrong: keep the details in %LOCALAPPDATA%\BichiPond\error.log and say where they are.
        private static void Report(string what, Exception ex)
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BichiPond"), log = Path.Combine(dir, "error.log");
            try { Directory.CreateDirectory(dir); File.AppendAllText(log, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {what} (Windows {Environment.OSVersion.Version})\r\n{ex}\r\n\r\n"); } catch (Exception) { }
            MessageBox.Show($"{what}：{ex.Message}\n\n详细信息已记录在：\n{log}", "碧池观鱼", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        // ---------- tray ----------
        private void BuildTray()
        {
            tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            tray.Text = "碧池观鱼";
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem("碧池观鱼") { Enabled = false });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("打开交互窗口", null, (s, e) => OpenWindow());
            var weatherMenu = new ToolStripMenuItem("天气");
            foreach (var (name, value) in new[] { ("晴日", "sunny"), ("多云", "cloudy"), ("下雨", "rain"), ("落雪", "snow") })
                weatherMenu.DropDownItems.Add(new ToolStripMenuItem(name, null, (s, e) => { weather = value; Command($"{{weather:'{value}'}}"); }) { Tag = value });
            weatherMenu.DropDownItems.Add(new ToolStripSeparator());
            var nightItem = new ToolStripMenuItem("月下观鱼", null, (s, e) => { night = !night; Command(night ? "{night:true}" : "{night:false}"); });
            weatherMenu.DropDownItems.Add(nightItem);
            menu.Items.Add(weatherMenu);
            var pause = new ToolStripMenuItem("暂停壁纸动画", null, (s, e) => { userPaused = !userPaused; UpdateVisibility(); });
            menu.Items.Add(pause);
            menu.Items.Add("重载桌面壁纸", null, (s, e) => Rebuild(0));
            var startup = new ToolStripMenuItem("开机时启动", null, (s, e) => SetStartup(!IsStartup()));
            menu.Items.Add(startup);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出碧池观鱼", null, (s, e) => Quit());
            menu.Opening += (s, e) =>
            {
                foreach (ToolStripItem i in weatherMenu.DropDownItems) if (i is ToolStripMenuItem mi && mi.Tag is string v) mi.Checked = v == weather;
                nightItem.Checked = night; pause.Checked = userPaused; startup.Checked = IsStartup();
            };
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => OpenWindow();
            tray.Visible = true;
        }

        public async void OpenWindow()
        {
            if (env == null) return;
            if (window != null && !window.IsDisposed) { window.WindowState = window.WindowState == FormWindowState.Minimized ? FormWindowState.Normal : window.WindowState; window.Activate(); return; }
            window = new InteractiveForm();
            window.FormClosed += (s, e) => { window = null; };
            await window.Start(env, OnSave);
        }

        private static bool IsStartup()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKey)) return key?.GetValue(RunName) != null;
        }

        private static void SetStartup(bool on)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on) key.SetValue(RunName, $"\"{Application.ExecutablePath}\"");
                else key.DeleteValue(RunName, false);
            }
        }

        private void Quit()
        {
            if (quitting) return;
            quitting = true;
            watch.Stop();
            if (hook != IntPtr.Zero) Native.UnhookWindowsHookEx(hook);
            tray.Visible = false;
            window?.Close();
            foreach (var w in walls) { try { w.Close(); } catch (Exception) { } }
            Desktop.Refresh();
            shell.DestroyHandle();
            ExitThread();
        }
    }

    /// <summary>A hidden window that hears Explorer restarting (TaskbarCreated), after which the desktop layers are new.</summary>
    internal sealed class ShellWatcher : NativeWindow
    {
        private readonly uint taskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");
        private readonly Action onRestart;
        public ShellWatcher(Action onRestart) { this.onRestart = onRestart; CreateHandle(new CreateParams()); }
        protected override void WndProc(ref Message m)
        {
            if (taskbarCreated != 0 && (uint)m.Msg == taskbarCreated) onRestart();
            base.WndProc(ref m);
        }
    }
}
