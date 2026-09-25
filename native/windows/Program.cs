// 碧池观鱼 · Windows entry point: one copy at a time, then the pond takes the desktop.
using System;
using System.Threading;
using System.Windows.Forms;

namespace BichiPond
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            using (var single = new Mutex(true, @"Local\BichiKoiPond", out bool first))
            {
                if (!first)
                {
                    MessageBox.Show("碧池观鱼已经在运行，可在任务栏通知区域的锦鲤图标中打开或退出。", "碧池观鱼", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                System.Threading.SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
                Application.Run(new PondApp());
            }
        }
    }
}
