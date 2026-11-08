// Letterflow-Helfer: globale Tastenüberwachung, Fokus-Erkennung und Einfügen.
// Protokoll: eine JSON-Zeile je Nachricht (UTF-8) über stdin/stdout. Siehe src/main/helper.js.
// Datenschutz: Es wird nie gemeldet, WELCHE normale Taste gedrückt wurde, nur dass eine gedrückt wurde.
// Nur C# 5 (Compiler aus .NET Framework 4).
using System;
using System.Collections.Concurrent;
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
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("kernel32.dll")]
        public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr h);
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int ret);
    }

    static class Program
    {
        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
        const uint LLKHF_INJECTED = 0x10;
        const uint KEYEVENTF_KEYUP = 0x2;
        const int VK_UNASSIGNED = 0xE8;
        // Markierung eigener SendInput-Ereignisse, damit der Hook sie ignoriert
        static readonly UIntPtr OwnMark = new UIntPtr(0x4C46);

        static readonly object OutLock = new object();
        static StreamWriter stdout;
        static readonly BlockingCollection<string> Queue = new BlockingCollection<string>();
        static volatile bool maskOn;
        static Native.HookProc hookProc;

        static void Main()
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;

            // Schreiber-Thread: der Hook legt nur in die Warteschlange und kehrt sofort zurück
            Thread writer = new Thread(WriterLoop);
            writer.IsBackground = true;
            writer.Start();

            Thread hook = new Thread(HookThread);
            hook.IsBackground = true;
            hook.Start();

            StreamReader stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                string l = line;
                // Befehle in eigenen Threads, damit mask/Hook nie auf focus/paste warten
                ThreadPool.QueueUserWorkItem(delegate { HandleCommand(l); });
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
                            // Startmenü unterdrücken: vor dem WIN-Loslassen eine unbelegte Taste einschieben
                            if (up && maskOn && (k.vkCode == 0x5B || k.vkCode == 0x5C)) SendKeyTap(VK_UNASSIGNED);
                            Emit("{\"ev\":\"key\",\"key\":\"" + name + "\",\"down\":" + (down ? "true" : "false") + "}");
                        }
                        else if (down)
                        {
                            // Nie den Tastencode melden, nur dass etwas gedrückt wurde
                            Emit("{\"ev\":\"other\"}");
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
            i.u.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
            i.u.ki.dwExtraInfo = OwnMark;
            return i;
        }

        static void SendKeys(params Native.INPUT[] inputs)
        {
            Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
        }

        static void SendKeyTap(int vk)
        {
            SendKeys(KeyInput(vk, false), KeyInput(vk, true));
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
                    maskOn = Regex.IsMatch(line, "\"on\"\\s*:\\s*true");
                }
                else if (cmd == "focus")
                {
                    Emit("{\"id\":" + id + ",\"focus\":" + FocusJson() + "}");
                }
                else if (cmd == "paste")
                {
                    Match h = Regex.Match(line, "\"hwnd\"\\s*:\\s*(\\d+)");
                    long hwnd = h.Success ? long.Parse(h.Groups[1].Value) : 0;
                    Emit("{\"id\":" + id + ",\"paste\":" + PasteJson(hwnd) + "}");
                }
            }
            catch { }
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
            if (fg != IntPtr.Zero)
            {
                uint pid;
                Native.GetWindowThreadProcessId(fg, out pid);
                elevated = IsElevated(pid);
                StringBuilder sb = new StringBuilder(256);
                Native.GetClassName(fg, sb, 256);
                string cls = sb.ToString();
                if (elevated || cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") editable = "no";
                else editable = ProbeEditable();
            }
            return "{\"hwnd\":" + hwnd + ",\"editable\":\"" + editable + "\",\"elevated\":" + (elevated ? "true" : "false") + "}";
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

        static string PasteJson(long hwnd)
        {
            DateTime end = DateTime.UtcNow.AddSeconds(3);
            while (ModifiersHeld())
            {
                if (DateTime.UtcNow > end) return "{\"ok\":false,\"reason\":\"tasten-gehalten\"}";
                Thread.Sleep(10);
            }
            if (Native.GetForegroundWindow().ToInt64() != hwnd) return "{\"ok\":false,\"reason\":\"fenster-gewechselt\"}";
            SendKeys(KeyInput(0x11, false), KeyInput(0x56, false), KeyInput(0x56, true), KeyInput(0x11, true));
            return "{\"ok\":true,\"reason\":null}";
        }
    }
}
