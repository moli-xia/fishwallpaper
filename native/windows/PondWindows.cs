// 碧池观鱼 · the windows that show the pond: one wallpaper per screen (inside the desktop, no controls) and the
// interactive window with all of the pond's controls. Both are the same web page in WebView2, served from the web\
// folder beside the exe under https://pond.local, so storage, weather lookups and WebGL work as in a browser.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BichiPond
{
    internal static class PondPage
    {
        public const string Host = "pond.local";
        public static readonly Color Backdrop = Color.FromArgb(0x74, 0x8d, 0x79);
        public static string WebFolder => Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");

        /// <summary>A WebView2 showing the pond; <paramref name="mode"/> "wallpaper" hides the page's controls.</summary>
        public static async Task<WebView2> Create(Control parent, CoreWebView2Environment env, string mode, Action<WebView2, string> onSave)
        {
            var view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Backdrop };
            parent.Controls.Add(view);
            await view.EnsureCoreWebView2Async(env);
            var core = view.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(Host, WebFolder, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = mode == null;
            core.Settings.AreDevToolsEnabled = true; // F12 in the interactive window, for checking a machine
            // The pond hands every save to the host, which passes it on to the other pages.
            core.WebMessageReceived += (s, e) => { string json = null; try { json = e.TryGetWebMessageAsString(); } catch (ArgumentException) { } if (json != null) onSave(view, json); };
            // Links out of the pond (the weather service credit) open in the default browser.
            core.NewWindowRequested += (s, e) => { e.Handled = true; OpenInBrowser(e.Uri); };
            core.NavigationStarting += (s, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.Host == Host) return;
                e.Cancel = true; OpenInBrowser(e.Uri);
            };
            // If the page's renderer dies (GPU reset, low memory), load the pond again rather than leave a blank desktop.
            core.ProcessFailed += (s, e) => { try { core.Reload(); } catch (Exception) { } };
            core.Navigate($"https://{Host}/index.html" + (mode == null ? "" : "?mode=" + mode));
            return view;
        }

        public static void OpenInBrowser(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception) { }
        }

        /// <summary>A JavaScript string literal for any text (JSON saves included).</summary>
        public static string JsString(string s)
        {
            var sb = new System.Text.StringBuilder(s.Length + 16).Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\u2028': sb.Append("\\u2028"); break;
                    case '\u2029': sb.Append("\\u2029"); break;
                    default: if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c); break;
                }
            }
            return sb.Append('"').ToString();
        }
    }

    /// <summary>The pond as one screen's wallpaper, living in the desktop behind the icons.</summary>
    internal sealed class WallpaperForm : Form
    {
        public Screen Screen { get; }
        public WebView2 View { get; private set; }
        public bool Hidden { get; private set; }

        public WallpaperForm(Screen screen)
        {
            Screen = screen;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Bounds = screen.Bounds;
            BackColor = PondPage.Backdrop;
            AutoScaleMode = AutoScaleMode.None; // sizes are the screen's real pixels, never rescaled
            Text = "碧池观鱼 Wallpaper";
        }

        /// <summary>Last pause state sent to the page, so it is only told when that changes.</summary>
        public bool? Paused { get; set; }

        // Never take focus from whatever the person is using.
        protected override bool ShowWithoutActivation => true;

        public async Task Start(CoreWebView2Environment env, Action<WebView2, string> onSave)
        {
            CreateHandle();
            // Once inside the desktop the window's position is relative to its new parent; keep WinForms in agreement.
            Bounds = Desktop.Attach(Handle, Screen.Bounds);
            Show();
            View = await PondPage.Create(this, env, "wallpaper", onSave);
        }

        /// <summary>Stops drawing while nobody can see it (a maximised app over it, the screen locked), and back.</summary>
        public void SetHidden(bool hidden)
        {
            if (Hidden == hidden || View?.CoreWebView2 == null) return;
            Hidden = hidden;
            View.Visible = !hidden; // WebView2 throttles a hidden view; the page sees document.hidden and rests
        }

        /// <summary>A tap at a screen point (device px) on this screen's desktop.</summary>
        public void Tap(Point screenPoint)
        {
            if (View?.CoreWebView2 == null) return;
            double k = Native.ScaleOf(Handle);
            double x = (screenPoint.X - Screen.Bounds.Left) / k, y = (screenPoint.Y - Screen.Bounds.Top) / k;
            _ = View.CoreWebView2.ExecuteScriptAsync(FormattableString.Invariant($"window.pondTap&&pondTap({x:0.#},{y:0.#})"));
        }
    }

    /// <summary>The pond with all its controls: feeding, naming koi, weather, sound and settings.</summary>
    internal sealed class InteractiveForm : Form
    {
        public WebView2 View { get; private set; }

        public InteractiveForm()
        {
            Text = "碧池观鱼";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            BackColor = PondPage.Backdrop;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(LogicalToDeviceUnits(1180), LogicalToDeviceUnits(760));
            MinimumSize = new Size(LogicalToDeviceUnits(440), LogicalToDeviceUnits(600));
        }

        public async Task Start(CoreWebView2Environment env, Action<WebView2, string> onSave)
        {
            Show();
            View = await PondPage.Create(this, env, null, onSave);
        }
    }
}
