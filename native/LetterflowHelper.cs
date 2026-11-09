// Letterflow-Helfer: globale Tastenüberwachung, Fokus-Erkennung und Einfügen.
// Protokoll: eine JSON-Zeile je Nachricht (UTF-8) über stdin/stdout. Siehe src/main/helper.js.
// Datenschutz: Es wird nie gemeldet, WELCHE normale Taste gedrückt wurde, nur dass eine gedrückt wurde.
// Nur C# 5 (Compiler aus .NET Framework 4).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

namespace Letterflow
{
    static class Native
    {
        public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int ptX;
            public int ptY;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
        [DllImport("user32.dll")]
        public static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vk);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("kernel32.dll")]
        public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool QueryFullProcessImageName(IntPtr proc, int flags, StringBuilder sb, ref int size);
        public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int ret);
        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr dc);
        [DllImport("user32.dll")]
        public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
        [DllImport("gdi32.dll")]
        public static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")]
        public static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")]
        public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
        [DllImport("gdi32.dll")]
        public static extern int GetDIBits(IntPtr dc, IntPtr bmp, uint start, uint lines, byte[] bits, byte[] bmi, uint usage);
    }

    static class Program
    {
        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
        const uint LLKHF_INJECTED = 0x10;
        const uint KEYEVENTF_KEYUP = 0x2;
        const uint KEYEVENTF_EXTENDEDKEY = 0x1;
        const int VK_UNASSIGNED = 0xE8;
        // Markierung eigener SendInput-Ereignisse, damit der Hook sie ignoriert
        static readonly UIntPtr OwnMark = new UIntPtr(0x4C46);

        static readonly object OutLock = new object();
        static StreamWriter stdout;
        static readonly BlockingCollection<string> Queue = new BlockingCollection<string>();
        static volatile bool maskOn;
        // Zustand der gehaltenen Modifier-Tasten und der Win-Tasten, bei denen die Maske gilt (unter StateLock)
        static readonly object StateLock = new object();
        static readonly HashSet<uint> heldKeys = new HashSet<uint>();
        static readonly HashSet<uint> latchedWin = new HashSet<uint>();
        static Timer pollTimer;
        static bool pollScheduled;
        const int PollMs = 250;
        static Native.HookProc hookProc;

        static void Main()
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;

            // Schreiber-Thread: der Hook legt nur in die Warteschlange und kehrt sofort zurück
            Thread writer = new Thread(WriterLoop);
            writer.IsBackground = true;
            writer.Start();

            pollTimer = new Timer(PollHeld, null, Timeout.Infinite, Timeout.Infinite);

            Thread hook = new Thread(HookThread);
            hook.IsBackground = true;
            hook.Start();

            StreamReader stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                string l = line;
                // mask wird sofort und in Reihenfolge verarbeitet (on/off dürfen sich nie überholen);
                // focus/paste/grab laufen in eigenen Threads, damit sie nichts blockieren
                if (Regex.IsMatch(l, "\"cmd\"\\s*:\\s*\"mask\"")) HandleCommand(l);
                else ThreadPool.QueueUserWorkItem(delegate { HandleCommand(l); });
            }
            // stdin zu: Elternprozess ist weg
            Environment.Exit(0);
        }

        static void Emit(string json)
        {
            Queue.Add(json);
        }

        static void WriterLoop()
        {
            foreach (string s in Queue.GetConsumingEnumerable())
            {
                try
                {
                    lock (OutLock) { stdout.WriteLine(s); }
                }
                catch (IOException) { Environment.Exit(0); }
            }
        }

        // ---------- Tastatur-Hook ----------

        static void HookThread()
        {
            hookProc = HookCallback;
            IntPtr mod = Marshal.GetHINSTANCE(typeof(Program).Module);
            IntPtr h = Native.SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, mod, 0);
            if (h == IntPtr.Zero) Environment.Exit(2);
            Emit("{\"ev\":\"ready\"}");
            Native.MSG msg;
            while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
        }

        static string KeyName(uint vk)
        {
            switch (vk)
            {
                case 0xA2: return "lctrl";
                case 0xA3: return "rctrl";
                case 0x5B: return "lwin";
                case 0x5C: return "rwin";
                case 0xA0: return "lshift";
                case 0xA1: return "rshift";
                default: return null;
            }
        }

        static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                try
                {
                    Native.KBDLLHOOKSTRUCT k = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                    bool own = (k.flags & LLKHF_INJECTED) != 0 && k.dwExtraInfo == OwnMark;
                    if (!own)
                    {
                        int m = wParam.ToInt32();
                        bool down = m == WM_KEYDOWN || m == WM_SYSKEYDOWN;
                        bool up = m == WM_KEYUP || m == WM_SYSKEYUP;
                        string name = KeyName(k.vkCode);
                        if (name != null)
                        {
                            bool isWin = k.vkCode == 0x5B || k.vkCode == 0x5C;
                            bool reinject = false;
                            lock (StateLock)
                            {
                                if (down)
                                {
                                    heldKeys.Add(k.vkCode);
                                    if (isWin && maskOn) latchedWin.Add(k.vkCode);
                                    SchedulePoll();
                                }
                                else if (up)
                                {
                                    heldKeys.Remove(k.vkCode);
                                    if (isWin && latchedWin.Remove(k.vkCode)) reinject = true;
                                }
                                // Im Lock, damit die Reihenfolge down/up zum Abfrage-Timer stimmt (Emit reiht nur ein)
                                Emit("{\"ev\":\"key\",\"key\":\"" + name + "\",\"down\":" + (down ? "true" : "false") + "}");
                            }
                            if (reinject)
                            {
                                // Startmenü unterdrücken: WIN-Loslassen zurückhalten und in fester Reihenfolge
                                // neu senden: unbelegte Taste, dann WIN hoch. Nichts geht verloren.
                                // Schlägt SendInput fehl (z. B. UIPI bei erhöhtem Fenster), geht das echte WIN-Loslassen durch.
                                if (SendKeys(KeyInput(VK_UNASSIGNED, false), KeyInput(VK_UNASSIGNED, true), KeyInput((int)k.vkCode, true)))
                                    return (IntPtr)1;
                            }
                        }
                        else if (down)
                        {
                            // Nie den Tastencode melden, nur dass etwas gedrückt wurde (Esc bricht das Diktat ab)
                            Emit(k.vkCode == 0x1B ? "{\"ev\":\"esc\"}" : "{\"ev\":\"other\"}");
                        }
                    }
                }
                catch { }
            }
            // Alle Tasten immer unverändert durchreichen
            return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        static Native.INPUT KeyInput(int vk, bool up)
        {
            Native.INPUT i = new Native.INPUT();
            i.type = 1;
            i.u.ki.wVk = (ushort)vk;
            i.u.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | ((vk == 0x5B || vk == 0x5C) ? KEYEVENTF_EXTENDEDKEY : 0);
            i.u.ki.dwExtraInfo = OwnMark;
            return i;
        }

        static bool SendKeys(params Native.INPUT[] inputs)
        {
            return Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.INPUT))) == (uint)inputs.Length;
        }

        // Läuft nur, solange Modifier-Tasten gehalten werden: erkennt verpasste Loslass-Ereignisse
        // (z. B. Win+L oder Strg+Alt+Entf, das Loslassen geschieht auf dem sicheren Desktop)
        static void SchedulePoll()
        {
            if (!pollScheduled)
            {
                pollScheduled = true;
                pollTimer.Change(PollMs, Timeout.Infinite);
            }
        }

        static void PollHeld(object state)
        {
            lock (StateLock)
            {
                List<uint> gone = new List<uint>();
                foreach (uint vk in heldKeys)
                    if (!IsDown((int)vk)) gone.Add(vk);
                foreach (uint vk in gone)
                {
                    heldKeys.Remove(vk);
                    latchedWin.Remove(vk);
                    Emit("{\"ev\":\"key\",\"key\":\"" + KeyName(vk) + "\",\"down\":false}");
                }
                pollScheduled = false;
                if (heldKeys.Count > 0) SchedulePoll();
            }
        }

        // ---------- Befehle ----------

        static void HandleCommand(string line)
        {
            try
            {
                Match c = Regex.Match(line, "\"cmd\"\\s*:\\s*\"(\\w+)\"");
                if (!c.Success) return;
                string cmd = c.Groups[1].Value;
                Match idm = Regex.Match(line, "\"id\"\\s*:\\s*(\\d+)");
                string id = idm.Success ? idm.Groups[1].Value : "0";

                if (cmd == "mask")
                {
                    bool on = Regex.IsMatch(line, "\"on\"\\s*:\\s*true");
                    lock (StateLock)
                    {
                        maskOn = on;
                        // Ist WIN schon gedrückt, gilt die Maske für diesen Tastendruck
                        if (on)
                        {
                            if (heldKeys.Contains(0x5B)) latchedWin.Add(0x5B);
                            if (heldKeys.Contains(0x5C)) latchedWin.Add(0x5C);
                        }
                    }
                }
                else if (cmd == "focus")
                {
                    Emit("{\"id\":" + id + ",\"focus\":" + FocusJson() + "}");
                }
                else if (cmd == "paste")
                {
                    Match h = Regex.Match(line, "\"hwnd\"\\s*:\\s*(\\d+)");
                    long hwnd = h.Success ? long.Parse(h.Groups[1].Value) : 0;
                    bool restore = Regex.IsMatch(line, "\"restore\"\\s*:\\s*true");
                    Emit("{\"id\":" + id + ",\"paste\":" + PasteJson(hwnd, restore) + "}");
                }
                else if (cmd == "grab")
                {
                    Emit("{\"id\":" + id + ",\"grab\":" + GrabJson(Zahl(line, "x"), Zahl(line, "y"), Zahl(line, "w"), Zahl(line, "h")) + "}");
                }
            }
            catch { }
        }

        static int Zahl(string line, string name)
        {
            Match m = Regex.Match(line, "\"" + name + "\"\\s*:\\s*(-?\\d+)");
            return m.Success ? int.Parse(m.Groups[1].Value) : 0;
        }

        // Bildschirmausschnitt (Gerätepixel) als BGRA, oben zuerst, Base64. Nur für das Glas der Pille:
        // die Pille selbst ist von Aufnahmen ausgenommen und erscheint nicht. Nichts wird gespeichert.
        static string GrabJson(int x, int y, int w, int h)
        {
            if (w <= 0 || h <= 0 || w > 4096 || h > 1024) return "null";
            IntPtr alt = Native.SetThreadDpiAwarenessContext(new IntPtr(-4)); // pro Monitor: echte Pixel
            IntPtr scr = Native.GetDC(IntPtr.Zero), mem = IntPtr.Zero, bmp = IntPtr.Zero;
            try
            {
                mem = Native.CreateCompatibleDC(scr);
                bmp = Native.CreateCompatibleBitmap(scr, w, h);
                IntPtr vorher = Native.SelectObject(mem, bmp);
                bool ok = Native.BitBlt(mem, 0, 0, w, h, scr, x, y, 0x00CC0020 | 0x40000000); // SRCCOPY | CAPTUREBLT
                Native.SelectObject(mem, vorher);
                if (!ok) return "null";
                byte[] bmi = new byte[40]; // BITMAPINFOHEADER: 32 Bit, oben zuerst (negative Höhe)
                BitConverter.GetBytes(40).CopyTo(bmi, 0);
                BitConverter.GetBytes(w).CopyTo(bmi, 4);
                BitConverter.GetBytes(-h).CopyTo(bmi, 8);
                BitConverter.GetBytes((short)1).CopyTo(bmi, 12);
                BitConverter.GetBytes((short)32).CopyTo(bmi, 14);
                byte[] bits = new byte[w * h * 4];
                if (Native.GetDIBits(mem, bmp, 0, (uint)h, bits, bmi, 0) != h) return "null";
                return "{\"w\":" + w + ",\"h\":" + h + ",\"bgra\":\"" + Convert.ToBase64String(bits) + "\"}";
            }
            finally
            {
                if (bmp != IntPtr.Zero) Native.DeleteObject(bmp);
                if (mem != IntPtr.Zero) Native.DeleteDC(mem);
                Native.ReleaseDC(IntPtr.Zero, scr);
                if (alt != IntPtr.Zero) Native.SetThreadDpiAwarenessContext(alt);
            }
        }

        static bool IsElevated(uint pid)
        {
            IntPtr proc = Native.OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (proc == IntPtr.Zero) return true; // Zugriff verweigert -> erhöht
            try
            {
                IntPtr token;
                if (!Native.OpenProcessToken(proc, 0x8, out token)) return true; // TOKEN_QUERY
                try
                {
                    int elevation;
                    int ret;
                    if (!Native.GetTokenInformation(token, 20, out elevation, 4, out ret)) return true; // TokenElevation
                    return elevation != 0;
                }
                finally { Native.CloseHandle(token); }
            }
            finally { Native.CloseHandle(proc); }
        }

        static string FocusJson()
        {
            IntPtr fg = Native.GetForegroundWindow();
            long hwnd = fg.ToInt64();
            bool elevated = false;
            string editable = "unknown";
            string exe = null, appName = null;
            if (fg != IntPtr.Zero)
            {
                uint pid;
                Native.GetWindowThreadProcessId(fg, out pid);
                elevated = IsElevated(pid);
                ProgramOf(fg, pid, out exe, out appName);
                StringBuilder sb = new StringBuilder(256);
                Native.GetClassName(fg, sb, 256);
                string cls = sb.ToString();
                if (elevated || cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") editable = "no";
                else editable = ProbeEditable();
            }
            return "{\"hwnd\":" + hwnd + ",\"editable\":\"" + editable + "\",\"elevated\":" + (elevated ? "true" : "false")
                + ",\"exe\":" + JsonStr(exe) + ",\"appName\":" + JsonStr(appName) + "}";
        }

        static string JsonStr(string s)
        {
            if (s == null) return "null";
            StringBuilder b = new StringBuilder("\"");
            foreach (char ch in s)
            {
                if (ch == '\\' || ch == '"') b.Append('\\').Append(ch);
                else if (ch < 0x20) b.Append("\\u").Append(((int)ch).ToString("x4"));
                else b.Append(ch);
            }
            return b.Append('"').ToString();
        }

        static string ExePath(uint pid)
        {
            IntPtr proc = Native.OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (proc == IntPtr.Zero) return null; // z. B. erhöhter Prozess
            try
            {
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                return Native.QueryFullProcessImageName(proc, 0, sb, ref size) ? sb.ToString() : null;
            }
            finally { Native.CloseHandle(proc); }
        }

        // Pfad und Anzeigename des Programms hinter dem Fenster; nie der Fenstertitel
        static void ProgramOf(IntPtr fg, uint pid, out string exe, out string appName)
        {
            exe = null; appName = null;
            try
            {
                exe = ExePath(pid);
                // UWP: Das Vordergrundfenster gehört dem ApplicationFrameHost, die App steckt in einem Kindfenster
                if (exe != null && Path.GetFileName(exe).Equals("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
                {
                    string inner = null;
                    Native.EnumChildWindows(fg, delegate(IntPtr child, IntPtr lp)
                    {
                        uint cp;
                        Native.GetWindowThreadProcessId(child, out cp);
                        if (cp == pid) return true;
                        inner = ExePath(cp);
                        return inner == null;
                    }, IntPtr.Zero);
                    if (inner != null) exe = inner;
                }
                if (exe == null) return;
                string desc = null;
                try { desc = FileVersionInfo.GetVersionInfo(exe).FileDescription; } catch { }
                appName = !string.IsNullOrWhiteSpace(desc) ? desc.Trim() : Path.GetFileNameWithoutExtension(exe);
            }
            catch { }
        }

        // UI Automation mit hartem Timeout von 300 ms
        static string ProbeEditable()
        {
            string result = "unknown";
            Thread t = new Thread(delegate()
            {
                try
                {
                    AutomationElement el = AutomationElement.FocusedElement;
                    if (el == null) return;
                    ControlType ct = el.Current.ControlType;
                    if (ct == ControlType.Edit || ct == ControlType.Document) { result = "yes"; return; }
                    object pat;
                    if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pat))
                    {
                        if (!((ValuePattern)pat).Current.IsReadOnly) result = "yes";
                    }
                }
                catch { }
            });
            t.IsBackground = true;
            t.Start();
            if (!t.Join(300)) return "unknown";
            return result;
        }

        static bool IsDown(int vk)
        {
            return (Native.GetAsyncKeyState(vk) & 0x8000) != 0;
        }

        static bool ModifiersHeld()
        {
            // STRG, UMSCHALT, ALT, linke und rechte WIN-Taste
            return IsDown(0x11) || IsDown(0x10) || IsDown(0x12) || IsDown(0x5B) || IsDown(0x5C);
        }

        // Holt ein Fenster nach vorn. Ein eigener Tastendruck (unbelegte Taste, markiert) macht den Helfer zum
        // Empfänger der letzten Eingabe; hilft das nicht, wird kurz an den Eingabe-Thread des Vordergrundfensters gehängt.
        static bool Activate(IntPtr target)
        {
            for (int attempt = 0; attempt < 2; attempt++)
            {
                IntPtr fg = Native.GetForegroundWindow();
                if (fg == target) return true;
                uint me = Native.GetCurrentThreadId(), pid;
                uint other = fg == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(fg, out pid);
                bool attached = attempt == 1 && other != 0 && other != me && Native.AttachThreadInput(me, other, true);
                try
                {
                    SendKeys(KeyInput(VK_UNASSIGNED, false), KeyInput(VK_UNASSIGNED, true));
                    Native.SetForegroundWindow(target);
                }
                finally { if (attached) Native.AttachThreadInput(me, other, false); }
                for (int i = 0; i < 25; i++)
                {
                    if (Native.GetForegroundWindow() == target) return true;
                    Thread.Sleep(10);
                }
            }
            return Native.GetForegroundWindow() == target;
        }

        static string PasteJson(long hwnd, bool restore)
        {
            DateTime end = DateTime.UtcNow.AddSeconds(3);
            while (ModifiersHeld())
            {
                if (DateTime.UtcNow > end) return "{\"ok\":false,\"reason\":\"tasten-gehalten\"}";
                Thread.Sleep(10);
            }
            IntPtr target = new IntPtr(hwnd);
            IntPtr previous = Native.GetForegroundWindow();
            bool switched = previous != target;
            if (switched)
            {
                uint pid;
                // Nur zurückholen, wenn das Fenster noch existiert und nicht erhöht ist (UIPI würde Strg+V schlucken)
                if (!restore || hwnd == 0 || !Native.IsWindow(target)
                    || Native.GetWindowThreadProcessId(target, out pid) == 0 || IsElevated(pid)
                    || !Activate(target))
                    return "{\"ok\":false,\"reason\":\"fenster-gewechselt\"}";
                Thread.Sleep(60); // Fokus im Fenster setzen lassen
            }
            // Nie in ein falsches Fenster: unmittelbar vor dem Senden prüfen
            if (Native.GetForegroundWindow() != target) return "{\"ok\":false,\"reason\":\"fenster-gewechselt\"}";
            bool sent = SendKeys(KeyInput(0x11, false), KeyInput(0x56, false), KeyInput(0x56, true), KeyInput(0x11, true));
            if (switched && sent && previous != IntPtr.Zero && Native.IsWindow(previous))
            {
                Thread.Sleep(150); // Zielfenster verarbeitet Strg+V, dann zurück
                Activate(previous);
            }
            return "{\"ok\":" + (sent ? "true" : "false") + ",\"reason\":null}";
        }
    }
}
