// Letterflow-Helfer: globale Tastenüberwachung, Fokus-Erkennung, Einfügen, Mikrofon (WASAPI) und Vordergrund-Meldung.
// Protokoll: eine JSON-Zeile je Nachricht (UTF-8) über stdin/stdout. Siehe src/main/helper.js.
// Datenschutz: Es wird nie gemeldet, WELCHE normale Taste gedrückt wurde, nur dass eine gedrückt wurde.
// Der Text direkt um die Schreibmarke (je höchstens 40 Zeichen) geht nur an die App, nie in ein Protokoll.
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
using System.Xml;
using System.Windows.Automation;
using System.Windows.Automation.Text;

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
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetPackageFullName(IntPtr proc, ref int len, StringBuilder sb);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetPackagePathByFullName(string fullName, ref int len, StringBuilder sb);
        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
        public static extern int SHLoadIndirectString(string src, StringBuilder sb, int cch, IntPtr reserved);
        [DllImport("user32.dll")]
        public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")]
        public static extern IntPtr GetClassLongPtr(IntPtr hWnd, int index);
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

        public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        [DllImport("user32.dll")]
        public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
        [DllImport("shell32.dll")]
        public static extern int SHQueryUserNotificationState(out int state);
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int left, top, right, bottom; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll")]
        public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
        [DllImport("user32.dll")]
        public static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hWnd, int index);
        [DllImport("kernel32.dll")]
        public static extern IntPtr CreateEvent(IntPtr attr, bool manual, bool initial, string name);
        [DllImport("kernel32.dll")]
        public static extern uint WaitForSingleObject(IntPtr h, uint ms);
        [DllImport("ole32.dll")]
        public static extern int PropVariantClear(ref PropVariant pv);
    }

    // ---------- Core Audio (WASAPI): nur die benötigten Methoden, in Vtable-Reihenfolge ----------

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey { public Guid fmtid; public int pid; }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant { public ushort vt, r1, r2, r3; public IntPtr p, p2; }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorKlasse { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr par, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore props);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long def, out long min);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr ev);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devPos, out ulong qpcPos);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
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
        static Native.WinEventProc winEventProc;
        static long vordergrundNr;
        static Thread micThread;
        static volatile bool micRun;

        static void Main()
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;

            // Schreiber-Thread: der Hook legt nur in die Warteschlange und kehrt sofort zurück
            Thread writer = new Thread(WriterLoop);
            writer.IsBackground = true;
            writer.Start();

            pollTimer = new Timer(PollHeld, null, Timeout.Infinite, Timeout.Infinite);

            micThread = new Thread(MikrofonVorwaermen);
            micThread.IsBackground = true;
            micThread.SetApartmentState(ApartmentState.MTA);
            micThread.Start();

            Thread hook = new Thread(HookThread);
            hook.IsBackground = true;
            hook.Start();

            StreamReader stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                string l = line;
                // mask und mic werden sofort und in Reihenfolge verarbeitet (an/aus dürfen sich nie überholen);
                // focus/paste/grab/vollbild laufen in eigenen Threads, damit sie nichts blockieren
                if (Regex.IsMatch(l, "\"cmd\"\\s*:\\s*\"(mask|mic)\"")) HandleCommand(l);
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
            // Vordergrundwechsel melden (die App lädt das Programmsymbol vorab). Der Rückruf läuft auf diesem
            // Thread (Nachrichtenschleife unten) und reicht nur weiter: der Tastatur-Hook wartet nie.
            winEventProc = VordergrundGewechselt;
            Native.SetWinEventHook(3, 3, IntPtr.Zero, winEventProc, 0, 0, 2); // EVENT_SYSTEM_FOREGROUND, WINEVENT_SKIPOWNPROCESS
            VordergrundGewechselt(IntPtr.Zero, 3, Native.GetForegroundWindow(), 0, 0, 0, 0);
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
                else if (cmd == "mic")
                {
                    Match d = Regex.Match(line, "\"device\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                    MikrofonSchalten(Regex.IsMatch(line, "\"on\"\\s*:\\s*true"), d.Success ? Regex.Unescape(d.Groups[1].Value) : null, Zahl(line, "warm"));
                }
                else if (cmd == "vollbild")
                {
                    Emit("{\"id\":" + id + ",\"vollbild\":" + (Vollbild() ? "true" : "false") + "}");
                }
                else if (cmd == "grab")
                {
                    Emit("{\"id\":" + id + ",\"grab\":" + GrabJson(Zahl(line, "x"), Zahl(line, "y"), Zahl(line, "w"), Zahl(line, "h")) + "}");
                }
            }
            catch { }
        }

        // ---------- Mikrofon: WASAPI, geteilter Modus, ereignisgesteuert ----------
        // Windows wandelt selbst in 16 kHz mono Float (AUTOCONVERTPCM). Pakete (erstes sofort, dann ab 20 ms)
        // gehen als Base64 ({"ev":"pcm","b":...}) an die App; dazu {"ev":"mic"} mit started (+ warm), error
        // (Name wie im Browser) oder stopped. Audio fließt nur zwischen an und aus.
        // Warm: Das Öffnen (Initialize) kostet je nach Gerät ~0,2 s. Nach einer Aufnahme bleibt der Strom daher
        // bis zu `warm` ms geöffnet, aber gestoppt: kein Ton, kein Mikrofon-Symbol; der nächste Start dauert ~10 ms.

        class MicStrom
        {
            public IMMDeviceEnumerator en;
            public IMMDevice dev;
            public IAudioClient client;
            public IAudioCaptureClient cap;
            public IntPtr ev;
            public string geraet;
        }

        static readonly object MicLock = new object();
        static MicStrom warmStrom; // unter MicLock
        static readonly Timer kaltTimer = new Timer(delegate { Parken(null, 0); }, null, Timeout.Infinite, Timeout.Infinite);

        // Läuft auf dem stdin-Thread, in Reihenfolge. Eine neue Aufnahme wartet, bis die vorige ganz zu ist.
        static void MikrofonSchalten(bool an, string geraet, int warmMs)
        {
            micRun = false;
            if (!an) return;
            if (micThread != null) micThread.Join();
            micRun = true;
            micThread = new Thread(delegate() { Aufnehmen(geraet ?? "", warmMs); });
            micThread.IsBackground = true;
            micThread.SetApartmentState(ApartmentState.MTA);
            micThread.Start();
        }

        // Strom warm ablegen (ms > 0) oder schließen; ein vorher abgelegter wird geschlossen.
        // shortcut: ein warmer Strom folgt keinem Wechsel des Windows-Standardgeräts (höchstens `warm` ms lang).
        static void Parken(MicStrom s, int ms)
        {
            MicStrom alt;
            lock (MicLock)
            {
                alt = warmStrom;
                warmStrom = ms > 0 ? s : null;
                kaltTimer.Change(ms > 0 && s != null ? ms : Timeout.Infinite, Timeout.Infinite);
            }
            if (alt != s) Schliessen(alt);
            if (ms <= 0) Schliessen(s);
        }

        static void Schliessen(MicStrom s)
        {
            if (s == null) return;
            Freigeben(s.cap);
            Freigeben(s.client);
            Freigeben(s.dev);
            Freigeben(s.en);
            if (s.ev != IntPtr.Zero) Native.CloseHandle(s.ev);
        }

        // Beim Start des Helfers einmal öffnen (der erste Start im Prozess dauert sonst ~0,4 s) und warm ablegen.
        static void MikrofonVorwaermen()
        {
            string fehler;
            Parken(Oeffnen("", out fehler), 15000);
        }

        static string MicFehler(int hr, bool laeuft)
        {
            if (hr == unchecked((int)0x80070005)) return "NotAllowedError"; // E_ACCESSDENIED: Datenschutz sperrt
            if (hr == unchecked((int)0x88890004) || hr == unchecked((int)0x80070490)) // Gerät weg / nicht gefunden
                return laeuft ? "TrackEndedError" : "NotFoundError";
            return "Error";
        }

        static void Freigeben(object o)
        {
            if (o != null) Marshal.FinalReleaseComObject(o);
        }

        static string GeraeteName(IMMDevice d)
        {
            IPropertyStore ps;
            if (d.OpenPropertyStore(0, out ps) != 0) return null; // STGM_READ
            try
            {
                PropertyKey k = new PropertyKey(); // PKEY_Device_FriendlyName
                k.fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0");
                k.pid = 14;
                PropVariant v;
                if (ps.GetValue(ref k, out v) != 0) return null;
                string name = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : null; // VT_LPWSTR
                Native.PropVariantClear(ref v);
                return name;
            }
            finally { Freigeben(ps); }
        }

        // Windows-Standard (leer) oder das aktive Aufnahmegerät mit diesem Namen (wie ihn die Einstellungen zeigen).
        static IMMDevice Geraet(IMMDeviceEnumerator en, string name)
        {
            IMMDevice d;
            if (name == "") return en.GetDefaultAudioEndpoint(1, 0, out d) == 0 ? d : null; // eCapture, eConsole
            IMMDeviceCollection alle;
            if (en.EnumAudioEndpoints(1, 1, out alle) != 0) return null; // DEVICE_STATE_ACTIVE
            try
            {
                int n;
                alle.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    if (alle.Item(i, out d) != 0) continue;
                    if (GeraeteName(d) == name) return d;
                    Freigeben(d);
                }
                return null;
            }
            finally { Freigeben(alle); }
        }

        // Gerät öffnen (16 kHz mono Float, Ereignis, noch nicht gestartet); null mit Fehlername.
        static MicStrom Oeffnen(string geraet, out string fehler)
        {
            MicStrom s = new MicStrom();
            s.geraet = geraet;
            IntPtr fmt = IntPtr.Zero;
            fehler = null;
            try
            {
                s.en = (IMMDeviceEnumerator)new MMDeviceEnumeratorKlasse();
                s.dev = Geraet(s.en, geraet);
                if (s.dev == null) fehler = "NotFoundError";
                else
                {
                    Guid iid = typeof(IAudioClient).GUID;
                    object o;
                    int hr = s.dev.Activate(ref iid, 0x17, IntPtr.Zero, out o); // CLSCTX_ALL
                    if (hr == 0)
                    {
                        s.client = (IAudioClient)o;
                        // WAVEFORMATEX: IEEE-Float, 1 Kanal, 16000 Hz, 32 Bit
                        fmt = Marshal.AllocCoTaskMem(18);
                        Marshal.WriteInt16(fmt, 0, 3);
                        Marshal.WriteInt16(fmt, 2, 1);
                        Marshal.WriteInt32(fmt, 4, 16000);
                        Marshal.WriteInt32(fmt, 8, 64000);
                        Marshal.WriteInt16(fmt, 12, 4);
                        Marshal.WriteInt16(fmt, 14, 32);
                        Marshal.WriteInt16(fmt, 16, 0);
                        // EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY, Puffer 200 ms
                        hr = s.client.Initialize(0, unchecked((int)0x88040000), 2000000, 0, fmt, IntPtr.Zero);
                    }
                    if (hr == 0)
                    {
                        s.ev = Native.CreateEvent(IntPtr.Zero, false, false, null);
                        hr = s.client.SetEventHandle(s.ev);
                    }
                    if (hr == 0)
                    {
                        Guid capId = typeof(IAudioCaptureClient).GUID;
                        hr = s.client.GetService(ref capId, out o);
                        if (hr == 0) s.cap = (IAudioCaptureClient)o;
                    }
                    if (hr != 0) fehler = MicFehler(hr, false);
                }
            }
            catch (UnauthorizedAccessException) { fehler = "NotAllowedError"; }
            catch (Exception) { fehler = "Error"; }
            finally { if (fmt != IntPtr.Zero) Marshal.FreeCoTaskMem(fmt); }
            if (fehler == null) return s;
            Schliessen(s);
            return null;
        }

        static void PcmAusgeben(float[] werte, int n)
        {
            byte[] b = new byte[n * 4];
            Buffer.BlockCopy(werte, 0, b, 0, b.Length);
            Emit("{\"ev\":\"pcm\",\"b\":\"" + Convert.ToBase64String(b) + "\"}");
        }

        static void Aufnehmen(string geraet, int warmMs)
        {
            MicStrom s;
            lock (MicLock)
            {
                s = warmStrom;
                warmStrom = null;
                kaltTimer.Change(Timeout.Infinite, Timeout.Infinite);
            }
            bool warm = s != null && s.geraet == geraet, gestartet = false;
            string fehler = null;
            try
            {
                if (s != null && !warm) { Schliessen(s); s = null; }
                if (warm)
                {
                    s.client.Reset(); // nichts Altes aus dem Puffer
                    if (s.client.Start() != 0) { Schliessen(s); s = null; warm = false; } // z. B. Gerät inzwischen weg
                }
                if (s == null)
                {
                    s = Oeffnen(geraet, out fehler);
                    if (s == null) return;
                    int hr = s.client.Start();
                    if (hr != 0) { fehler = MicFehler(hr, false); return; }
                }
                gestartet = true;
                Emit("{\"ev\":\"mic\",\"started\":true,\"warm\":" + (warm ? "true" : "false") + "}");
                float[] werte = new float[16000];
                int fuell = 0;
                bool weiter = true, erstes = true;
                while (weiter)
                {
                    weiter = micRun; // nach dem Stopp noch einmal alles abholen
                    Native.WaitForSingleObject(s.ev, weiter ? 100u : 0u);
                    uint n;
                    int hr;
                    while ((hr = s.cap.GetNextPacketSize(out n)) == 0 && n > 0)
                    {
                        IntPtr data;
                        uint frames, flags;
                        ulong p1, p2;
                        hr = s.cap.GetBuffer(out data, out frames, out flags, out p1, out p2);
                        if (hr != 0) break;
                        int m = (int)frames;
                        if (fuell + m > werte.Length) { PcmAusgeben(werte, fuell); fuell = 0; }
                        if (m > werte.Length) m = werte.Length;
                        if ((flags & 2) != 0) Array.Clear(werte, fuell, m); // AUDCLNT_BUFFERFLAGS_SILENT
                        else Marshal.Copy(data, werte, fuell, m);
                        fuell += m;
                        s.cap.ReleaseBuffer(frames);
                    }
                    if (hr != 0) { fehler = MicFehler(hr, true); break; }
                    // Erstes Paket sofort (Startzeit), danach ab 20 ms
                    if (fuell > 0 && (fuell >= 320 || erstes || !weiter)) { PcmAusgeben(werte, fuell); fuell = 0; erstes = false; }
                }
                if (fuell > 0) PcmAusgeben(werte, fuell);
            }
            catch (UnauthorizedAccessException) { fehler = "NotAllowedError"; }
            catch (Exception) { fehler = "Error"; }
            finally
            {
                try { if (gestartet) s.client.Stop(); } catch { }
                Parken(s, fehler == null ? warmMs : 0); // nach einem Fehler nie warm halten
                if (fehler != null) Emit("{\"ev\":\"mic\",\"error\":\"" + fehler + "\"}");
                Emit("{\"ev\":\"mic\",\"stopped\":true}");
            }
        }

        // ---------- Vollbild: dann keine Pille und keine Bildschirmerfassung ----------

        static bool IstShell(IntPtr hwnd)
        {
            StringBuilder sb = new StringBuilder(256);
            Native.GetClassName(hwnd, sb, 256);
            string cls = sb.ToString();
            return cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd";
        }

        // Windows meldet exklusives Direct3D-Vollbild oder Präsentationsmodus (QUNS_RUNNING_D3D_FULL_SCREEN,
        // QUNS_PRESENTATION_MODE), oder das Vordergrundfenster ohne Titelleiste deckt seinen ganzen Bildschirm
        // (randloses Vollbild, Video). QUNS_BUSY allein zählt nicht: gemessen auch bei normalem Fenster vorn.
        static bool Vollbild()
        {
            int s;
            if (Native.SHQueryUserNotificationState(out s) == 0 && (s == 3 || s == 4)) return true;
            IntPtr fg = Native.GetForegroundWindow();
            if (fg == IntPtr.Zero || IstShell(fg)) return false;
            if ((Native.GetWindowLong(fg, -16) & 0x00C00000) == 0x00C00000) return false; // WS_CAPTION: normales/maximiertes Fenster
            IntPtr alt = Native.SetThreadDpiAwarenessContext(new IntPtr(-4)); // echte Pixel für beide Rechtecke
            try
            {
                Native.RECT r;
                Native.MONITORINFO mi = new Native.MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO));
                if (!Native.GetWindowRect(fg, out r) || !Native.GetMonitorInfo(Native.MonitorFromWindow(fg, 2), ref mi)) return false;
                Native.RECT m = mi.rcMonitor;
                return r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
            }
            finally { if (alt != IntPtr.Zero) Native.SetThreadDpiAwarenessContext(alt); }
        }

        // ---------- Vordergrund: Programm melden, damit die App das Symbol vorab lädt ----------

        static void VordergrundGewechselt(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            if (idObject != 0 || hwnd == IntPtr.Zero) return; // nur ganze Fenster
            long nr = Interlocked.Increment(ref vordergrundNr);
            ThreadPool.QueueUserWorkItem(delegate { VordergrundMelden(hwnd, nr); });
        }

        // Desktop, Taskleiste und erhöhte Programme: exe null (die Pille zeigt dann das Letterflow-Symbol).
        static void VordergrundMelden(IntPtr hwnd, long nr)
        {
            try
            {
                string exe = null, name = null, icon = null;
                uint pid;
                Native.GetWindowThreadProcessId(hwnd, out pid);
                if (!IstShell(hwnd) && !IsElevated(pid)) ProgramOf(hwnd, pid, out exe, out name, out icon);
                // Nur der neueste Wechsel zählt (Meldungen aus dem Thread-Pool können sich überholen)
                if (nr == Interlocked.Read(ref vordergrundNr))
                    Emit("{\"ev\":\"vordergrund\",\"exe\":" + JsonStr(exe) + ",\"appName\":" + JsonStr(name)
                        + ",\"icon\":" + JsonStr(icon) + ",\"fensterIcon\":" + JsonStr(icon == null ? FensterSymbol(hwnd, exe) : null) + "}");
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
            string exe = null, appName = null, icon = null, vor = null, nach = null;
            if (fg != IntPtr.Zero)
            {
                uint pid;
                Native.GetWindowThreadProcessId(fg, out pid);
                elevated = IsElevated(pid);
                ProgramOf(fg, pid, out exe, out appName, out icon);
                StringBuilder sb = new StringBuilder(256);
                Native.GetClassName(fg, sb, 256);
                string cls = sb.ToString();
                if (elevated || cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") editable = "no";
                else editable = ProbeEditable(out vor, out nach);
            }
            return "{\"hwnd\":" + hwnd + ",\"editable\":\"" + editable + "\",\"elevated\":" + (elevated ? "true" : "false")
                + ",\"exe\":" + JsonStr(exe) + ",\"appName\":" + JsonStr(appName) + ",\"icon\":" + JsonStr(icon) + ",\"fensterIcon\":" + JsonStr(icon == null ? FensterSymbol(fg, exe) : null)
                + ",\"vor\":" + JsonStr(vor) + ",\"nach\":" + JsonStr(nach) + "}";
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

        // Pfad und Anzeigename des Programms hinter dem Fenster; nie der Fenstertitel.
        // icon: Logo-Datei (PNG) bei Paket-Apps (Store, WhatsApp …), deren Exe weder Namen noch Symbol trägt.
        static void ProgramOf(IntPtr fg, uint pid, out string exe, out string appName, out string icon)
        {
            exe = null; appName = null; icon = null;
            try
            {
                exe = ExePath(pid);
                // UWP: Das Vordergrundfenster gehört dem ApplicationFrameHost, die App steckt in einem Kindfenster
                if (exe != null && Path.GetFileName(exe).Equals("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
                {
                    string inner = null;
                    uint innerPid = 0;
                    Native.EnumChildWindows(fg, delegate(IntPtr child, IntPtr lp)
                    {
                        uint cp;
                        Native.GetWindowThreadProcessId(child, out cp);
                        if (cp == pid) return true;
                        inner = ExePath(cp);
                        innerPid = cp;
                        return inner == null;
                    }, IntPtr.Zero);
                    if (inner != null) { exe = inner; pid = innerPid; }
                }
                if (exe == null) return;
                if (PaketApp(pid, exe, out appName, out icon)) return;
                string desc = null;
                try { desc = FileVersionInfo.GetVersionInfo(exe).FileDescription; } catch { }
                appName = !string.IsNullOrWhiteSpace(desc) ? desc.Trim() : Path.GetFileNameWithoutExtension(exe);
            }
            catch { }
        }

        static readonly ConcurrentDictionary<string, string> fensterSymbole = new ConcurrentDictionary<string, string>();

        // Symbol des Fensters als PNG (je Exe einmal, im Temp-Ordner). Ersatz für Programme, deren Exe kein
        // Symbol trägt (Office: WINWORD.EXE liefert nur das leere Standardsymbol). null: keins.
        static string FensterSymbol(IntPtr hwnd, string exe)
        {
            if (exe == null || hwnd == IntPtr.Zero) return null;
            string schon;
            if (fensterSymbole.TryGetValue(exe, out schon)) return schon;
            string pfad = null;
            try
            {
                IntPtr h;
                Native.SendMessageTimeout(hwnd, 0x7F, new IntPtr(1), IntPtr.Zero, 2, 100, out h); // WM_GETICON, ICON_BIG, SMTO_ABORTIFHUNG
                if (h == IntPtr.Zero) h = Native.GetClassLongPtr(hwnd, -14); // GCLP_HICON
                if (h != IntPtr.Zero)
                {
                    string dir = Path.Combine(Path.GetTempPath(), "Letterflow-Symbole");
                    Directory.CreateDirectory(dir);
                    pfad = Path.Combine(dir, Path.GetFileNameWithoutExtension(exe) + "-" + ((uint)exe.ToLowerInvariant().GetHashCode()).ToString("x8") + ".png");
                    using (System.Drawing.Icon ico = System.Drawing.Icon.FromHandle(h))
                    using (System.Drawing.Bitmap bmp = ico.ToBitmap())
                        bmp.Save(pfad, System.Drawing.Imaging.ImageFormat.Png);
                }
            }
            catch { pfad = null; }
            if (pfad != null) fensterSymbole[exe] = pfad; // ohne Symbol: beim nächsten Mal neu versuchen
            return pfad;
        }

        static readonly ConcurrentDictionary<string, string[]> paketCache = new ConcurrentDictionary<string, string[]>();

        // Paket-App: Anzeigename und Logo aus dem AppxManifest (wie Startmenü und Taskleiste). false: kein Paket.
        static bool PaketApp(uint pid, string exe, out string name, out string logo)
        {
            name = null; logo = null;
            string voll;
            IntPtr proc = Native.OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (proc == IntPtr.Zero) return false;
            try
            {
                int len = 0;
                if (Native.GetPackageFullName(proc, ref len, null) != 122 || len <= 0) return false; // 122: Puffer zu klein, also Paket
                StringBuilder sb = new StringBuilder(len);
                if (Native.GetPackageFullName(proc, ref len, sb) != 0) return false;
                voll = sb.ToString();
            }
            finally { Native.CloseHandle(proc); }
            string[] info = paketCache.GetOrAdd(voll + "|" + exe, delegate { return PaketLesen(voll, exe); });
            if (info == null || info[0] == null) return false;
            name = info[0]; logo = info[1];
            return true;
        }

        static string[] PaketLesen(string voll, string exe)
        {
            try
            {
                int len = 1024;
                StringBuilder sb = new StringBuilder(len);
                if (Native.GetPackagePathByFullName(voll, ref len, sb) != 0) return null;
                string wurzel = sb.ToString().TrimEnd('\\');
                XmlDocument doc = new XmlDocument();
                doc.XmlResolver = null;
                doc.Load(Path.Combine(wurzel, "AppxManifest.xml"));
                XmlElement id = doc.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']") as XmlElement;
                // Die Application zur Exe, sonst die erste
                string rel = exe.StartsWith(wurzel + "\\", StringComparison.OrdinalIgnoreCase) ? exe.Substring(wurzel.Length + 1) : null;
                XmlElement app = null;
                foreach (XmlNode n in doc.SelectNodes("//*[local-name()='Application']"))
                {
                    XmlElement a = n as XmlElement;
                    if (a == null) continue;
                    if (app == null) app = a;
                    if (rel != null && rel.Equals(a.GetAttribute("Executable"), StringComparison.OrdinalIgnoreCase)) { app = a; break; }
                }
                XmlElement ve = app == null ? null : app.SelectSingleNode("*[local-name()='VisualElements']") as XmlElement;
                if (ve == null) return null;
                string name = Aufloesen(ve.GetAttribute("DisplayName"), voll, id == null ? "" : id.GetAttribute("Name"));
                string logo = LogoDatei(wurzel, ve.GetAttribute("Square44x44Logo")) ?? LogoDatei(wurzel, ve.GetAttribute("Square150x150Logo"));
                return new string[] { string.IsNullOrWhiteSpace(name) ? null : name.Trim(), logo };
            }
            catch { return null; }
        }

        // „ms-resource:…“ über die Ressourcen des Pakets auflösen, sonst den Text selbst
        static string Aufloesen(string wert, string voll, string paketName)
        {
            if (string.IsNullOrEmpty(wert) || !wert.StartsWith("ms-resource:", StringComparison.OrdinalIgnoreCase)) return wert;
            string rest = wert.Substring(12);
            string[] versuche = {
                rest.StartsWith("//") ? wert
                    : rest.StartsWith("/") ? "ms-resource://" + paketName + rest
                    : "ms-resource://" + paketName + "/resources/" + rest,
                "ms-resource:" + rest.TrimStart('/'),
            };
            foreach (string uri in versuche)
            {
                StringBuilder sb = new StringBuilder(512);
                if (Native.SHLoadIndirectString("@{" + voll + "? " + uri + "}", sb, sb.Capacity, IntPtr.Zero) == 0) return sb.ToString();
            }
            return null;
        }

        // Das Logo liegt in Varianten auf der Platte (…targetsize-48_altform-unplated.png, …scale-200.png).
        // Bevorzugt: ohne Hintergrundplatte, Zielgröße nahe 48 px; Kontrast-Varianten nie.
        static string LogoDatei(string wurzel, string logo)
        {
            if (string.IsNullOrEmpty(logo)) return null;
            string voll = Path.Combine(wurzel, logo);
            string dir = Path.GetDirectoryName(voll), stamm = Path.GetFileNameWithoutExtension(voll), ext = Path.GetExtension(voll);
            if (!Directory.Exists(dir)) return null;
            string best = File.Exists(voll) ? voll : null;
            int bestWert = best == null ? int.MinValue : 0;
            foreach (string f in Directory.GetFiles(dir, stamm + ".*" + ext))
            {
                string q = Path.GetFileNameWithoutExtension(f).Substring(stamm.Length).ToLowerInvariant();
                if (q.Contains("contrast")) continue;
                int wert = 0;
                if (q.Contains("altform-unplated")) wert += 100;
                else if (q.Contains("altform-lightunplated")) wert += 50;
                Match m = Regex.Match(q, "targetsize-(\\d+)");
                if (m.Success) { int t = int.Parse(m.Groups[1].Value); wert += t >= 32 ? 60 - Math.Abs(t - 48) : 0; }
                else if (q.Contains("scale-200")) wert += 30;
                if (wert > bestWert) { bestWert = wert; best = f; }
            }
            return best;
        }

        // UI Automation mit hartem Timeout von 300 ms. Dauert nur das Lesen um die Schreibmarke zu lange,
        // bleibt das Ergebnis „Textfeld“ gültig, vor/nach sind dann null.
        static string ProbeEditable(out string vor, out string nach)
        {
            object sync = new object();
            string result = "unknown", v = null, n = null;
            Thread t = new Thread(delegate()
            {
                try
                {
                    AutomationElement el = AutomationElement.FocusedElement;
                    if (el == null) return;
                    ControlType ct = el.Current.ControlType;
                    bool ja = ct == ControlType.Edit || ct == ControlType.Document;
                    object pat;
                    if (!ja && el.TryGetCurrentPattern(ValuePattern.Pattern, out pat))
                        ja = !((ValuePattern)pat).Current.IsReadOnly;
                    if (!ja) return;
                    lock (sync) result = "yes";
                    if (el.Current.IsPassword) return;
                    string a, b;
                    UmSchreibmarke(el, out a, out b);
                    lock (sync) { v = a; n = b; }
                }
                catch { }
            });
            t.IsBackground = true;
            t.Start();
            t.Join(300);
            lock (sync) { vor = v; nach = n; return result; }
        }

        // Text direkt vor und nach der Schreibmarke (bzw. Auswahl) über das TextPattern; sonst null.
        static void UmSchreibmarke(AutomationElement el, out string vor, out string nach)
        {
            vor = null; nach = null;
            object pat;
            if (!el.TryGetCurrentPattern(TextPattern.Pattern, out pat)) return;
            TextPatternRange[] sel = ((TextPattern)pat).GetSelection();
            if (sel == null || sel.Length == 0) return;
            TextPatternRange a = sel[0].Clone();
            a.MoveEndpointByRange(TextPatternRangeEndpoint.End, sel[0], TextPatternRangeEndpoint.Start);
            a.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, -40);
            TextPatternRange b = sel[0].Clone();
            b.MoveEndpointByRange(TextPatternRangeEndpoint.Start, sel[0], TextPatternRangeEndpoint.End);
            b.MoveEndpointByUnit(TextPatternRangeEndpoint.End, TextUnit.Character, 40);
            string x = a.GetText(-1), y = b.GetText(-1);
            vor = x.Length > 40 ? x.Substring(x.Length - 40) : x;
            nach = y.Length > 40 ? y.Substring(0, 40) : y;
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
