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
