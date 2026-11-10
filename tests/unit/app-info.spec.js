const { test, expect } = require('@playwright/test');
const { createAppInfo } = require('../../src/main/app-info');

const icon = { toDataURL: () => 'data:image/png;base64,AAAA' };

test('Name-Fallbacks: leer, nur Dateiname, sehr lang', async () => {
  const getAppInfo = createAppInfo({ getFileIcon: async () => icon });
  expect((await getAppInfo({ exe: null, appName: '  ' })).name).toBe('Unbekanntes Programm');
  expect((await getAppInfo({ exe: 'C:/x/notepad.exe', appName: null })).name).toBe('notepad');
  expect((await getAppInfo({ exe: null, appName: 'A'.repeat(100) })).name).toHaveLength(60);
  expect((await getAppInfo({ exe: null, appName: 'Word' })).iconDataUrl).toBeNull();
});

test('Symbol wird je Exe zwischengespeichert, Fehler → null', async () => {
  let calls = 0;
  const getAppInfo = createAppInfo({
    getFileIcon: async (exe) => {
      if (!exe.includes('ohne-symbol')) calls++;
      if (exe.includes('bad')) throw new Error('x');
      return icon;
    },
  });
  const a = await getAppInfo({ exe: 'C:/a.exe', appName: 'A' });
  await getAppInfo({ exe: 'C:/a.exe', appName: 'A' });
  expect(a.iconDataUrl).toBe('data:image/png;base64,AAAA');
  expect(calls).toBe(1);
  expect((await getAppInfo({ exe: 'C:/bad.exe', appName: 'B' })).iconDataUrl).toBeNull();
});

test('Leeres Windows-Programmsymbol → null (Pille zeigt Letterflow)', async () => {
  const bild = (px) => ({
    toBitmap: () => Buffer.from(px),
    toDataURL: () => 'data:image/png;base64,QQ==',
  });
  const getAppInfo = createAppInfo({
    getFileIcon: async (exe) =>
      bild(exe.includes('ohne-symbol') || exe.includes('leer') ? 'leer' : 'echt'),
  });
  expect((await getAppInfo({ exe: 'C:/leer.exe', appName: 'L' })).iconDataUrl).toBeNull();
  expect((await getAppInfo({ exe: 'C:/echt.exe', appName: 'E' })).iconDataUrl).toBe(
    'data:image/png;base64,QQ==',
  );
});

test('Paket-App: Logo aus dem Paket statt leerem Exe-Symbol', async () => {
  const logo = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,LOGO' };
  const getAppInfo = createAppInfo({ getFileIcon: async () => icon, loadImage: () => logo });
  const a = await getAppInfo({
    exe: 'C:/w/WhatsApp.Root.exe',
    appName: 'WhatsApp',
    icon: 'C:/w/a.png',
  });
  expect(a).toEqual({ name: 'WhatsApp', iconDataUrl: 'data:image/png;base64,LOGO' });
});

test('Exe mit leerem Symbol (Word): Fenstersymbol statt Letterflow-Symbol', async () => {
  const leer = { toBitmap: () => Buffer.from('leer') };
  const fenster = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,FENSTER' };
  const getAppInfo = createAppInfo({ getFileIcon: async () => leer, loadImage: () => fenster });
  const a = await getAppInfo({
    exe: 'C:/o/WINWORD.EXE',
    appName: 'Microsoft Word',
    fensterIcon: 'C:/t/w.png',
  });
  expect(a.iconDataUrl).toBe('data:image/png;base64,FENSTER');
  const b = await getAppInfo({ exe: 'C:/o/ohne.exe', appName: 'Ohne' });
  expect(b.iconDataUrl).toBeNull();
});
