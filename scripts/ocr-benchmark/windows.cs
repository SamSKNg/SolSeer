using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Media.Ocr;

internal class OcrBenchmark
{
    [STAThread]
    private static void Main(string[] args) { Run(args).GetAwaiter().GetResult(); }
    private static async Task Run(string[] args)
    {
        JavaScriptSerializer json = new JavaScriptSerializer();
        var cases = json.Deserialize<Dictionary<string, object>[]>(File.ReadAllText(args[0]));
        Stopwatch timer = Stopwatch.StartNew();
        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine == null) throw new Exception("Windows OCR language unavailable");
        double startupMs = timer.Elapsed.TotalMilliseconds;
        var read = typeof(SolseerScreenHelper).GetMethod("ReadPixelResult", BindingFlags.NonPublic | BindingFlags.Static);
        var rows = new List<object>();
        foreach (var item in cases)
        {
            using (var source = new Bitmap((string)item["path"]))
            using (var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
            {
                using (var graphics = Graphics.FromImage(bitmap)) graphics.DrawImageUnscaled(source, 0, 0);
                var locked = bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                byte[] pixels = new byte[bitmap.Width*bitmap.Height*4];
                try { for (int y=0;y<bitmap.Height;y++) Marshal.Copy(IntPtr.Add(locked.Scan0,y*locked.Stride),pixels,y*bitmap.Width*4,bitmap.Width*4); }
                finally { bitmap.UnlockBits(locked); }
                var times = new List<double>();
                OcrResult result = null;
                for (int run=0;run<6;run++)
                {
                    timer.Restart();
                    result = await (Task<OcrResult>)read.Invoke(null,new object[]{engine,pixels,bitmap.Width,bitmap.Height});
                    if(run>0) times.Add(timer.Elapsed.TotalMilliseconds);
                }
                times.Sort();
                item["text"] = result.Text;
                item["engineConfidence"] = null;
                item["medianMs"] = times[2];
                rows.Add(item);
                Console.WriteLine(item["id"] + " " + item["variant"] + " " + result.Text);
            }
        }
        File.WriteAllText(args[1],json.Serialize(new {engine="Windows OCR / " + engine.RecognizerLanguage.LanguageTag,startupMs=startupMs,rows=rows}));
    }
}
