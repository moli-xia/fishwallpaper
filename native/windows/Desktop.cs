// 碧池观鱼 · putting a window into the desktop, behind the icons.
// Explorer's desktop is Progman (the static wallpaper) with SHELLDLL_DefView (the icons) on top. Sending Progman the
// undocumented 0x052C message makes it split off a WorkerW layer between the two, the layer animated wallpapers use:
//   • up to Windows 11 23H2 the WorkerW is a top-level window just after the one holding SHELLDLL_DefView;
//   • from Windows 11 24H2, SHELLDLL_DefView and the WorkerW are both children of Progman, so the wallpaper becomes a
//     child of Progman itself, placed right under the icons.
using System;
using System.Drawing;

namespace BichiPond
{
    internal static class Desktop
    {
        /// <summary>The window the wallpaper is parented to; Progman when <see cref="Layered24H2"/>.</summary>
        public static IntPtr Host { get; private set; }
        /// <summary>SHELLDLL_DefView, the icon layer, when it is a sibling the wallpaper must sit under (24H2).</summary>
        public static IntPtr Icons { get; private set; }
        public static bool Layered24H2 { get; private set; }

        /// <summary>Finds (and if needed creates) the layer behind the desktop icons. False if Explorer is not running.</summary>
        public static bool Find()
        {
            IntPtr progman = Native.FindWindow("Progman", null);
            if (progman == IntPtr.Zero) return false;
            Native.SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), Native.SMTO_NORMAL, 1000, out _);
            Native.SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, Native.SMTO_NORMAL, 1000, out _);

            // Windows 11 24H2 and later: the icons and the WorkerW live inside Progman.
            IntPtr innerIcons = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            IntPtr innerWorker = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
            if (innerIcons != IntPtr.Zero && innerWorker != IntPtr.Zero)
            {
                Host = progman; Icons = innerIcons; Layered24H2 = true;
                return true;
            }

            // Earlier Windows: the WorkerW that follows the top-level window holding the icons.
            IntPtr worker = IntPtr.Zero;
            Native.EnumWindows((top, _) =>
            {
                if (Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                    worker = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
                return true;
            }, IntPtr.Zero);
            Host = worker != IntPtr.Zero ? worker : progman; // if the split never happened, Progman still works (under the icons)
            Icons = worker != IntPtr.Zero ? IntPtr.Zero : Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            Layered24H2 = false;
            return true;
        }

        /// <summary>Makes <paramref name="window"/> part of the desktop, covering <paramref name="screen"/> (screen pixels).
        /// Returns the same area in the host's client coordinates, where the window now lives.</summary>
        public static Rectangle Attach(IntPtr window, Rectangle screen)
        {
            // A tool window that never takes focus: it stays out of Alt-Tab and never steals the keyboard.
            long ex = Native.GetWindowLongPtr(window, Native.GWL_EXSTYLE).ToInt64() | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            // Progman on 24H2 composes its children without redirection bitmaps; a layered child renders reliably there.
            if (Layered24H2) ex |= Native.WS_EX_LAYERED;
            Native.SetWindowLongPtr(window, Native.GWL_EXSTYLE, new IntPtr(ex));
            if (Layered24H2) Native.SetLayeredWindowAttributes(window, 0, 255, Native.LWA_ALPHA);

            Native.SetParent(window, Host);
            // Screen pixels → the host's client coordinates (the host spans the whole virtual screen).
            var r = new Native.RECT { Left = screen.Left, Top = screen.Top, Right = screen.Right, Bottom = screen.Bottom };
            Native.MapWindowPoints(IntPtr.Zero, Host, ref r, 2);
            uint flags = Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW;
            if (Icons != IntPtr.Zero) Native.SetWindowPos(window, Icons, r.Left, r.Top, r.Width, r.Height, flags);  // right under the icons
            else Native.SetWindowPos(window, IntPtr.Zero, r.Left, r.Top, r.Width, r.Height, flags | Native.SWP_NOZORDER);
            return new Rectangle(r.Left, r.Top, r.Width, r.Height);
        }

        /// <summary>Repaints the plain desktop wallpaper, so nothing of the pond lingers after the app quits.</summary>
        public static void Refresh()
        {
            if (Host != IntPtr.Zero) Native.RedrawWindow(Host, IntPtr.Zero, IntPtr.Zero, Native.RDW_INVALIDATE | Native.RDW_ERASE | Native.RDW_ALLCHILDREN | Native.RDW_UPDATENOW);
        }
    }
}
