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
      calls++;
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
