using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Storage.Streams;

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

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputData
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
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
    private const uint KeyboardKeyUp = 0x0002;
    private const ushort VirtualKeyO = 0x4F;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly string TempPrefix = "solseer-ocr-" + Process.GetCurrentProcess().Id + "-";
    private static bool stopping;
    private static int playMatches;
    private static int unclearBiomeScans;
    private static int zoomPresses;
    private static DateTime lastClick = DateTime.MinValue;
    private static DateTime lastZoom = DateTime.MinValue;

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint inputCount, Input[] inputs, int inputSize);

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
        public Rectangle BiomeRegion;
        public Rectangle PlayRegion;
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
        finally
        {
            DeleteTemporaryFiles();
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
                BiomeRegion = new Rectangle(0, 780, 460, 170),
                PlayRegion = new Rectangle(0, 820, 600, 250),
                PlayX = 264,
                PlayY = 1000
            };
        return new ScreenProfile
        {
            Name = "1440p",
            Width = 2560,
            Height = 1440,
            BiomeRegion = new Rectangle(0, 1080, 600, 220),
            PlayRegion = new Rectangle(0, 1120, 760, 319),
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
            if (status != previousStatus)
            {
                Emit(Status(status, StatusMessage(status, profile)));
                previousStatus = status;
            }
            if (status == "scanning")
            {
                try
                {
                    string biomeText = await CaptureAndRead(engine, window, profile.BiomeRegion, "biome");
                    string playText = autoStart
                        ? await CaptureAndRead(engine, window, profile.PlayRegion, "play")
                        : "";
                    bool biomeFound = LooksLikeBiome(biomeText);
                    bool playFound = LooksLikePlay(playText);
                    if (autoStart)
                    {
                        playMatches = playFound ? playMatches + 1 : 0;
                        if (biomeFound)
                        {
                            unclearBiomeScans = 0;
                            zoomPresses = 0;
                        }
                        else if (playFound)
                        {
                            unclearBiomeScans = 0;
                            zoomPresses = 0;
                        }
                        else unclearBiomeScans++;
                    }
                    bool clicked = false;
                    bool clickAttempted = false;
                    bool zoomedOut = false;
                    if (autoStart && playMatches >= 2 && DateTime.UtcNow - lastClick >= TimeSpan.FromSeconds(15))
                    {
                        RobloxWindow current;
                        if (TryGetRobloxWindow(out current) && current.Handle == window.Handle && IsFullscreen(current, profile))
                        {
                            clickAttempted = true;
                            clicked = ClickPlay(current, profile);
                            if (clicked)
                            {
                                lastClick = DateTime.UtcNow;
                                playMatches = 0;
                            }
                        }
                    }
                    if (autoStart && !playFound && unclearBiomeScans >= 3 && zoomPresses < 8 && DateTime.UtcNow - lastZoom >= TimeSpan.FromMilliseconds(750))
                    {
                        RobloxWindow current;
                        if (TryGetRobloxWindow(out current) && current.Handle == window.Handle && IsFullscreen(current, profile))
                        {
                            zoomedOut = PressO();
                            if (zoomedOut)
                            {
                                zoomPresses++;
                                lastZoom = DateTime.UtcNow;
                            }
                        }
                    }
                    Dictionary<string, object> scan = new Dictionary<string, object>();
                    scan["kind"] = "scan";
                    scan["status"] = "scanning";
                    scan["biomeText"] = biomeText;
                    scan["biomeFound"] = biomeFound;
                    scan["playFound"] = playFound;
                    scan["clickAttempted"] = clickAttempted;
                    scan["clicked"] = clicked;
                    scan["zoomedOut"] = zoomedOut;
                    scan["zoomPresses"] = zoomPresses;
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
        if (status == "roblox_not_foreground") return "Bring Roblox to the foreground.";
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
            Process process = Process.GetProcessById((int)processId);
            if (process.ProcessName.IndexOf("Roblox", StringComparison.OrdinalIgnoreCase) < 0) return false;
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

    private static async Task<string> CaptureAndRead(OcrEngine engine, RobloxWindow window, Rectangle relative, string name)
    {
        string path = Path.Combine(Path.GetTempPath(), TempPrefix + name + ".png");
        try
        {
            using (Bitmap bitmap = new Bitmap(relative.Width, relative.Height, PixelFormat.Format24bppRgb))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.CopyFromScreen(window.Monitor.Left + relative.X, window.Monitor.Top + relative.Y, 0, 0, relative.Size, CopyPixelOperation.SourceCopy);
                bitmap.Save(path, ImageFormat.Png);
            }
            StorageFile file = await Await(StorageFile.GetFileFromPathAsync(path));
            using (IRandomAccessStream stream = await Await(file.OpenAsync(FileAccessMode.Read)))
            {
                BitmapDecoder decoder = await Await(BitmapDecoder.CreateAsync(stream));
                using (SoftwareBitmap bitmap = await Await(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied)))
                {
                    OcrResult result = await Await(engine.RecognizeAsync(bitmap));
                    return result.Text ?? "";
                }
            }
        }
        finally
        {
            try { File.Delete(path); } catch { }
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
            if (candidate.Length >= 3 && Similarity(candidate, "PLAY") >= 0.72) return true;
        }
        return false;
    }

    private static bool LooksLikeBiome(string text)
    {
        string[] biomes = new string[]
        {
            "NORMAL", "WINDY", "SNOWY", "RAINY", "SANDSTORM", "HELL",
            "STARFALL", "HEAVEN", "CORRUPTION", "NULL", "GLITCHED",
            "DREAMSPACE", "CYBERSPACE", "SINGULARITY", "PUMPKINMOON",
            "GRAVEYARD", "BLAZINGSUN", "BLOODRAIN", "AURORA", "EGGLAND",
            "INCINERATOR"
        };
        string normalized = Normalize(text);
        foreach (string biome in biomes)
            if (normalized.Contains(biome)) return true;
        string[] words = (text ?? "").Split(new char[] { ' ', '\r', '\n', '\t', '[', ']', ':', '.', ',' }, StringSplitOptions.RemoveEmptyEntries);
        foreach (string word in words)
        {
            string candidate = Normalize(word);
            if (candidate.Length < 3) continue;
            foreach (string biome in biomes)
                if (Similarity(candidate, biome) >= 0.72) return true;
        }
        return false;
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

    private static bool SendMouse(uint flag, int x = 0, int y = 0)
    {
        Input input = new Input();
        input.Type = 0;
        input.Data = new InputData
        {
            Mouse = new MouseInput
            {
                X = x,
                Y = y,
                MouseData = 0,
                Flags = flag,
                Time = 0,
                ExtraInfo = UIntPtr.Zero
            }
        };
        return SendInput(1, new Input[] { input }, Marshal.SizeOf(typeof(Input))) == 1;
    }

    private static bool PressO()
    {
        Input down = new Input();
        down.Type = 1;
        down.Data = new InputData
        {
            Keyboard = new KeyboardInput
            {
                VirtualKey = VirtualKeyO,
                ScanCode = 0,
                Flags = 0,
                Time = 0,
                ExtraInfo = UIntPtr.Zero
            }
        };
        Input up = down;
        up.Data.Keyboard.Flags = KeyboardKeyUp;
        if (SendInput(1, new Input[] { down }, Marshal.SizeOf(typeof(Input))) != 1) return false;
        Thread.Sleep(45);
        return SendInput(1, new Input[] { up }, Marshal.SizeOf(typeof(Input))) == 1;
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

    private static void DeleteTemporaryFiles()
    {
        foreach (string name in new string[] { "biome", "play" })
            try { File.Delete(Path.Combine(Path.GetTempPath(), TempPrefix + name + ".png")); } catch { }
    }
}
