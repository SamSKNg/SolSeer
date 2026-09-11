using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Media.Ocr;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using Size = System.Drawing.Size;

internal static class SolseerScreenHelper
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputData
    {
        [FieldOffset(0)] public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public InputData Data;
    }

    private const uint MonitorDefaultToNearest = 2;
    private const uint MouseMove = 0x0001;
    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static bool stopping;
    private static int playMatches;
    private static DateTime lastClick = DateTime.MinValue;
    private static IntPtr zoomWindow = IntPtr.Zero;
    private static int zoomNotches;
    private static DateTime zoomDeadline;

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint inputCount, Input[] inputs, int inputSize);


    [ComImport]
    [Guid("905a0fef-bc53-11df-8c49-001e4fc686da")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IBufferByteAccess
    {
        void Buffer(out IntPtr value);
    }

    private sealed class RobloxWindow
    {
        public IntPtr Handle;
        public Rect Bounds;
        public Rect Monitor;
    }

    private sealed class ScreenProfile
    {
        public string Name;
        public int Width;
        public int Height;
        public Rectangle OcrRegion;
        public Rectangle BiomeRegion;
        public int PlayX;
        public int PlayY;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs)
        {
            eventArgs.Cancel = true;
            stopping = true;
        };
        try
        {
            SetProcessDPIAware();
            bool autoStart = args != null && args.Length > 1 && String.Equals(args[1], "autostart", StringComparison.OrdinalIgnoreCase);
            Run(ProfileFor(args), autoStart).GetAwaiter().GetResult();
            return 0;
        }
        catch
        {
            Emit(Status("error", "Windows OCR could not start."));
            return 1;
        }
    }

    private static ScreenProfile ProfileFor(string[] args)
    {
        if (args != null && args.Length > 0 && String.Equals(args[0], "1080p", StringComparison.OrdinalIgnoreCase))
            return new ScreenProfile
            {
                Name = "1080p",
                Width = 1920,
                Height = 1080,
                OcrRegion = new Rectangle(0, 780, 600, 290),
                // Relative to the shared capture: absolute (4, 860, 320, 25).
                BiomeRegion = new Rectangle(4, 80, 320, 25),
                PlayX = 264,
                PlayY = 1000
            };
        return new ScreenProfile
        {
            Name = "1440p",
            Width = 2560,
            Height = 1440,
            OcrRegion = new Rectangle(0, 1080, 760, 359),
            // 1440p reference: absolute (5, 1150, 425, 32).
            BiomeRegion = new Rectangle(5, 70, 425, 32),
            PlayX = 342,
            PlayY = 1331
        };
    }

    private static async Task Run(ScreenProfile profile, bool autoStart)
    {
        OcrEngine engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine == null)
        {
            Emit(Status("ocr_unavailable", "Install a Windows OCR language pack."));
            return;
        }
        string previousStatus = null;
        while (!stopping)
        {
            RobloxWindow window;
            string status;
            if (!TryGetRobloxWindow(out window)) status = "roblox_not_foreground";
            else if (!IsFullscreen(window, profile)) status = "maximize_resolution";
            else status = "scanning";
            if (status != "scanning") { playMatches = 0; zoomNotches = 0; }
            if (status != previousStatus)
            {
                Emit(Status(status, StatusMessage(status, profile)));
                previousStatus = status;
            }
            if (status == "scanning")
            {
                try
                {
                    FrameReading reading = await CaptureAndRead(engine, window, profile);
                    string ocrText = reading.BiomeText;
                    // Discard a frame if focus changed while recognition was running.
                    if (!IsForeground(window)) { playMatches = 0; zoomNotches = 0; await Task.Delay(500); continue; }
                    bool biomeFound = LooksLikeBiome(ocrText);
                    bool playFound = LooksLikePlay(reading.OriginalText);
                    StepZoomOut(window, profile, playFound);
                    playMatches = autoStart && playFound ? playMatches + 1 : 0;
                    bool clicked = false;
                    bool clickAttempted = false;
                    if (autoStart && playMatches >= 2 && DateTime.UtcNow - lastClick >= TimeSpan.FromSeconds(15))
                    {
                        RobloxWindow current;
                        if (TryGetRobloxWindow(out current) && current.Handle == window.Handle && IsFullscreen(current, profile) && IsForeground(current))
                        {
                            clickAttempted = true;
                            clicked = ClickPlay(current, profile);
                            if (clicked)
                            {
                                lastClick = DateTime.UtcNow;
                                playMatches = 0;
                                zoomWindow = current.Handle;
                                zoomNotches = 10;
                                zoomDeadline = DateTime.UtcNow.AddSeconds(20);
                            }
                        }
                    }
                    Dictionary<string, object> scan = new Dictionary<string, object>();
                    scan["kind"] = "scan";
                    scan["status"] = "scanning";
                    scan["biomeText"] = ocrText;
                    scan["ocrChannel"] = reading.Channel;
                    scan["biomeFound"] = biomeFound;
                    scan["playFound"] = playFound;
                    scan["clickAttempted"] = clickAttempted;
                    scan["clicked"] = clicked;
                    scan["autoStart"] = autoStart;
                    scan["resolution"] = profile.Name;
                    scan["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    Emit(scan);
                }
                catch
                {
                    Emit(Status("scan_error", "The fullscreen frame could not be read."));
                }
            }
            await Task.Delay(500);
        }
    }

    private static Dictionary<string, object> Status(string status, string message)
    {
        Dictionary<string, object> result = new Dictionary<string, object>();
        result["kind"] = "status";
        result["status"] = status;
        result["message"] = message;
        result["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return result;
    }

    private static string StatusMessage(string status, ScreenProfile profile)
    {
        if (status == "roblox_not_foreground") return "OCR paused; bring Roblox to the foreground.";
        if (status == "maximize_resolution") return "Maximize Roblox on a " + profile.Width + "×" + profile.Height + " display.";
        return "Reading the Roblox window.";
    }

    private static void Emit(object value)
    {
        Console.WriteLine(Json.Serialize(value));
        Console.Out.Flush();
    }

    private static bool TryGetRobloxWindow(out RobloxWindow result)
    {
        result = null;
        IntPtr handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return false;
        uint processId;
        GetWindowThreadProcessId(handle, out processId);
        try
        {
            using (Process process = Process.GetProcessById((int)processId))
                if (!String.Equals(process.ProcessName, "RobloxPlayerBeta", StringComparison.OrdinalIgnoreCase)) return false;
        }
        catch { return false; }
        Rect bounds;
        if (!GetWindowRect(handle, out bounds)) return false;
        IntPtr monitorHandle = MonitorFromWindow(handle, MonitorDefaultToNearest);
        MonitorInfo monitor = new MonitorInfo();
        monitor.Size = Marshal.SizeOf(typeof(MonitorInfo));
        if (!GetMonitorInfo(monitorHandle, ref monitor)) return false;
        result = new RobloxWindow { Handle = handle, Bounds = bounds, Monitor = monitor.Monitor };
        return true;
    }

    private static bool IsForeground(RobloxWindow window)
    {
        return GetForegroundWindow() == window.Handle;
    }

    private static bool IsFullscreen(RobloxWindow window, ScreenProfile profile)
    {
        int monitorWidth = window.Monitor.Right - window.Monitor.Left;
        int monitorHeight = window.Monitor.Bottom - window.Monitor.Top;
        return monitorWidth == profile.Width && monitorHeight == profile.Height &&
            Math.Abs(window.Bounds.Left - window.Monitor.Left) <= 4 &&
            Math.Abs(window.Bounds.Top - window.Monitor.Top) <= 4 &&
            Math.Abs(window.Bounds.Right - window.Monitor.Right) <= 4 &&
            Math.Abs(window.Bounds.Bottom - window.Monitor.Bottom) <= 4;
    }

    private sealed class FrameReading
    {
        public string OriginalText;
        public string BiomeText;
        public string Channel = "original";
    }

    private static async Task<FrameReading> CaptureAndRead(OcrEngine engine, RobloxWindow window, ScreenProfile profile)
    {
        Rectangle relative = profile.OcrRegion;
        using (Bitmap bitmap = new Bitmap(relative.Width, relative.Height, PixelFormat.Format32bppArgb))
        {
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                if (!IsForeground(window)) throw new InvalidOperationException("Roblox is no longer foreground.");
                graphics.CopyFromScreen(window.Monitor.Left + relative.X, window.Monitor.Top + relative.Y, 0, 0, relative.Size, CopyPixelOperation.SourceCopy);
            }

            Rectangle bounds = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(bounds, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            byte[] pixels = new byte[bitmap.Width * bitmap.Height * 4];
            try
            {
                for (int row = 0; row < bitmap.Height; row++)
                    Marshal.Copy(IntPtr.Add(data.Scan0, row * data.Stride), pixels, row * bitmap.Width * 4, bitmap.Width * 4);
            }
            finally { bitmap.UnlockBits(data); }

            OcrResult originalResult = await ReadPixelResult(engine, pixels, bitmap.Width, bitmap.Height);
            string original = originalResult.Text ?? "";
            StringBuilder biomeText = new StringBuilder();
            foreach (OcrLine line in originalResult.Lines)
                foreach (OcrWord word in line.Words)
                {
                    Windows.Foundation.Rect box = word.BoundingRect;
                    if (profile.BiomeRegion.Contains((int)(box.X + box.Width / 2), (int)(box.Y + box.Height / 2)))
                        biomeText.Append(word.Text).Append(' ');
                }
            FrameReading reading = new FrameReading { OriginalText = original, BiomeText = biomeText.ToString().Trim() };
            // Retry only uncertain in-game reads, using the same captured frame.
            // Play is always classified from the original full-color pass.
            if (!LooksLikeBiome(reading.BiomeText) && !LooksLikePlay(original) && IsForeground(window))
            {
                Rectangle crop = profile.BiomeRegion;
                byte[] cropped = new byte[crop.Width * crop.Height * 4];
                for (int y = 0; y < crop.Height; y++)
                    System.Buffer.BlockCopy(pixels, ((crop.Y + y) * bitmap.Width + crop.X) * 4,
                        cropped, y * crop.Width * 4, crop.Width * 4);
                // Try red, green, then blue from the same frame. Do not let
                // scenery edge strength exclude a potentially readable channel.
                foreach (int channel in new int[] { 2, 1, 0 })
                {
                    if (stopping || !IsForeground(window)) break;
                    byte[] enhanced = ExtractColorChannel(cropped, crop.Width, crop.Size, channel);
                    string retry = (await ReadPixelResult(engine, enhanced, crop.Width, crop.Height)).Text ?? "";
                    double score = BiomeScore(retry);
                    if (score >= 0.70)
                    {
                        reading.BiomeText = retry;
                        reading.Channel = new string[] { "blue", "green", "red" }[channel];
                        break;
                    }
                }
            }
            // Unsuccessful frames are retried on the next polling cycle;
            // never publish a below-threshold candidate as the live result.
            if (!LooksLikeBiome(reading.BiomeText)) reading.BiomeText = "";
            return reading;
        }
    }

    // Each channel gets its own percentile contrast stretch, including faint
    // channels previously excluded by the minimum-range/edge-score filter.
    private static byte[] ExtractColorChannel(byte[] source, int sourceWidth, Size size, int channel)
    {
            int[] histogram = new int[256];
            for (int y = 0; y < size.Height; y++)
                for (int x = 0; x < size.Width; x++)
                {
                    int index = (y * sourceWidth + x) * 4 + channel;
                    int value = source[index];
                    histogram[value]++;
                }
            int count = size.Width * size.Height;
            int cumulative = 0, lower = -1, upper = 255;
            for (int value = 0; value < 256; value++)
            {
                cumulative += histogram[value];
                if (lower < 0 && cumulative >= Math.Max(1, count / 100)) lower = value;
                if (cumulative >= count - count / 100) { upper = value; break; }
            }
        int low = lower, high = upper;
        // If percentile clipping removed sparse lettering, use the full range.
        if (high <= low)
        {
            low = 0; high = 255;
            while (low < 255 && histogram[low] == 0) low++;
            while (high > low && histogram[high] == 0) high--;
        }
        byte[] output = new byte[size.Width * size.Height * 4];
        for (int y = 0; y < size.Height; y++)
            for (int x = 0; x < size.Width; x++)
            {
                int value = source[(y * sourceWidth + x) * 4 + channel];
                byte gray = high > low ? (byte)Math.Max(0, Math.Min(255, (value - low) * 255 / (high - low))) : (byte)255;
                int index = (y * size.Width + x) * 4;
                output[index] = output[index + 1] = output[index + 2] = gray;
                output[index + 3] = 255;
            }
        return output;
    }

    private static async Task<OcrResult> ReadPixelResult(OcrEngine engine, byte[] pixels, int width, int height)
    {
            Windows.Storage.Streams.Buffer buffer = new Windows.Storage.Streams.Buffer((uint)pixels.Length);
            IntPtr destination;
            ((IBufferByteAccess)(object)buffer).Buffer(out destination);
            Marshal.Copy(pixels, 0, destination, pixels.Length);
            buffer.Length = (uint)pixels.Length;
            using (SoftwareBitmap softwareBitmap = SoftwareBitmap.CreateCopyFromBuffer(
                buffer, BitmapPixelFormat.Bgra8, width, height, BitmapAlphaMode.Premultiplied))
            {
                OcrResult result = await Await(engine.RecognizeAsync(softwareBitmap));
                return result;
            }
    }

    private static Task<T> Await<T>(IAsyncOperation<T> operation)
    {
        TaskCompletionSource<T> completion = new TaskCompletionSource<T>();
        operation.Completed = delegate(IAsyncOperation<T> current, AsyncStatus status)
        {
            try
            {
                if (status == AsyncStatus.Completed) completion.SetResult(current.GetResults());
                else if (status == AsyncStatus.Canceled) completion.SetCanceled();
                else completion.SetException(new InvalidOperationException("Windows OCR operation failed."));
            }
            catch (Exception error) { completion.SetException(error); }
        };
        return completion.Task;
    }

    private static string Normalize(string value)
    {
        StringBuilder output = new StringBuilder();
        foreach (char character in (value ?? "").ToUpperInvariant())
            if (character >= 'A' && character <= 'Z') output.Append(character);
        return output.ToString();
    }

    private static bool LooksLikePlay(string text)
    {
        string normalized = Normalize(text);
        if (normalized.Contains("PLAY")) return true;
        string[] words = (text ?? "").Split(new char[] { ' ', '\r', '\n', '\t', '[', ']', ':', '.', ',' }, StringSplitOptions.RemoveEmptyEntries);
        foreach (string word in words)
        {
            string candidate = Normalize(word);
            if (candidate.Length >= 3 && Similarity(candidate, "PLAY") >= 0.70) return true;
        }
        return false;
    }

    private static bool LooksLikeBiome(string text)
    {
        return BiomeScore(text) >= 0.70;
    }

    // Mirror the backend's line-based text-similarity rules so early exit
    // cannot accept a word that the backend would subsequently reject.
    private static double BiomeScore(string text)
    {
        string[] biomes = new string[]
        {
            "NORMAL", "WINDY", "SNOWY", "RAINY", "SANDSTORM", "HELL",
            "STARFALL", "HEAVEN", "CORRUPTION", "NULL", "GLITCHED",
            "DREAMSPACE", "CYBERSPACE", "SINGULARITY", "PUMPKINMOON",
            "GRAVEYARD", "BLAZINGSUN", "BLOODRAIN", "AURORA", "EGGLAND",
            "INCINERATOR"
        };
        double best = -1;
        foreach (string line in (text ?? "").Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            StringBuilder normalized = new StringBuilder();
            foreach (char c in line.Normalize(NormalizationForm.FormKD).ToUpperInvariant())
                if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) normalized.Append(c);
            string candidate = normalized.ToString();
            if (candidate.Length < 3 || candidate.Length > 32) continue;
            foreach (string biome in biomes)
            {
                double score = candidate == biome ? 1 : candidate.Contains(biome) ? 0.96 :
                    biome.Contains(candidate) && candidate.Length >= 4 ? 0.82 : Similarity(candidate, biome);
                best = Math.Max(best, score);
            }
        }
        return best;
    }

    private static double Similarity(string left, string right)
    {
        int[,] distance = new int[left.Length + 1, right.Length + 1];
        for (int i = 0; i <= left.Length; i++) distance[i, 0] = i;
        for (int j = 0; j <= right.Length; j++) distance[0, j] = j;
        for (int i = 1; i <= left.Length; i++)
            for (int j = 1; j <= right.Length; j++)
                distance[i, j] = Math.Min(Math.Min(distance[i - 1, j] + 1, distance[i, j - 1] + 1), distance[i - 1, j - 1] + (left[i - 1] == right[j - 1] ? 0 : 1));
        return 1.0 - ((double)distance[left.Length, right.Length] / Math.Max(left.Length, right.Length));
    }

    // Run a bounded wheel burst alongside OCR, after the menu disappears.
    // Never refocus Roblox or continue a queued burst after an alt-tab.
    private static void StepZoomOut(RobloxWindow window, ScreenProfile profile, bool playFound)
    {
        if (zoomNotches <= 0) return;
        if (stopping || window.Handle != zoomWindow || !IsForeground(window) ||
            !IsFullscreen(window, profile) || DateTime.UtcNow >= zoomDeadline)
        { zoomNotches = 0; return; }
        if (playFound || DateTime.UtcNow - lastClick < TimeSpan.FromSeconds(1.5)) return;
        // Keep the wheel over the world, away from scrollable HUD panels.
        if (!SetCursorPos(window.Monitor.Left + profile.OcrRegion.Width + 200,
            window.Monitor.Top + profile.OcrRegion.Y / 2))
        { zoomNotches = 0; return; }
        for (int i = 0; i < 10 && zoomNotches > 0; i++)
        {
            if (stopping || !IsForeground(window) || !SendMouse(0x0800, 0, 0, -120))
            { zoomNotches = 0; return; }
            zoomNotches--;
        }
    }

    private static bool SendMouse(uint flag, int x = 0, int y = 0, int wheel = 0)
    {
        Input input = new Input();
        input.Type = 0;
        input.Data = new InputData
        {
            Mouse = new MouseInput
            {
                X = x,
                Y = y,
                MouseData = unchecked((uint)wheel),
                Flags = flag,
                Time = 0,
                ExtraInfo = UIntPtr.Zero
            }
        };
        return SendInput(1, new Input[] { input }, Marshal.SizeOf(typeof(Input))) == 1;
    }

    private static bool ClickPlay(RobloxWindow window, ScreenProfile profile)
    {
        // SetCursorPos alone does not always generate the motion event Roblox's
        // hover state listens for. Add a small SendInput sweep over the button,
        // allow a frame for hover/focus, then press without restoring the cursor.
        if (!SetCursorPos(window.Monitor.Left + profile.PlayX, window.Monitor.Top + profile.PlayY)) return false;
        Thread.Sleep(35);
        if (!SendMouse(MouseMove, 4, 0)) return false;
        Thread.Sleep(35);
        if (!SendMouse(MouseMove, -8, 0)) return false;
        Thread.Sleep(35);
        if (!SendMouse(MouseMove, 4, 0)) return false;
        Thread.Sleep(90);
        if (!SendMouse(MouseLeftDown)) return false;
        Thread.Sleep(80);
        if (!SendMouse(MouseLeftUp)) return false;
        Thread.Sleep(160);
        return true;
    }

}
