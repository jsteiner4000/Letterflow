const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseDevices,
  parseDedicatedVram,
  chooseBackend,
  chooseSmoothingTier,
  detectHardware,
} = require('../../src/main/hardware');

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', name + '.txt'), 'latin1');
const nvidia = { name: 'NVIDIA GeForce RTX 4060', vendor: 'nvidia' };
const amd = { name: 'AMD Radeon RX 7600', vendor: 'amd' };

test('Geräteliste: AMD-iGPU wird erkannt', () => {
  expect(parseDevices(fixture('list-devices-vega'))).toEqual([
    { name: 'AMD Radeon (TM) Graphics', vendor: 'amd' },
  ]);
});

test('Geräteliste: CPU-Build ergibt keine Geräte', () => {
  expect(parseDevices(fixture('list-devices-cpu'))).toEqual([]);
});

test('Geräteliste: Hersteller erkannt, Software-Renderer ignoriert', () => {
  const text = [
    'Available devices:',
    '  Vulkan0: NVIDIA GeForce RTX 4060 Laptop GPU (8188 MiB, 7000 MiB free)',
    '  Vulkan1: Intel(R) Arc(TM) Graphics (16000 MiB, 15000 MiB free)',
    '  Vulkan2: llvmpipe (LLVM 17.0.6, 256 bits) (31000 MiB, 30000 MiB free)',
    '  Vulkan3: Foo Accelerator (1024 MiB, 1000 MiB free)',
  ].join('\n');
  expect(parseDevices(text).map((d) => d.vendor)).toEqual(['nvidia', 'intel', 'other']);
});

test('Grafikspeicher: Vega-Laptop hat etwa 512 MiB', () => {
  expect(parseDedicatedVram(fixture('reg-query-vega'))).toBe(512);
});

test('Grafikspeicher: 8-GiB-Karte', () => {
  expect(parseDedicatedVram(fixture('reg-query-8gb'))).toBe(8192);
});

test('Grafikspeicher: nichts gefunden ergibt 0', () => {
  expect(parseDedicatedVram(fixture('reg-query-leer'))).toBe(0);
  expect(parseDedicatedVram('')).toBe(0);
});

test('Grafikspeicher: größter Wert gewinnt', () => {
  const text =
    '    HardwareInformation.qwMemorySize    REG_QWORD    0x20000000\r\n' +
    '    HardwareInformation.qwMemorySize    REG_QWORD    0x100000000\r\n';
  expect(parseDedicatedVram(text)).toBe(4096);
});

test('NVIDIA mit CUDA nimmt CUDA', () => expect(chooseBackend([nvidia], true)).toBe('cuda'));
test('NVIDIA ohne CUDA nimmt Vulkan', () => expect(chooseBackend([nvidia], false)).toBe('vulkan'));
test('AMD-iGPU nimmt Vulkan', () =>
  expect(chooseBackend(parseDevices(fixture('list-devices-vega')), false)).toBe('vulkan'));
test('CPU-Build ohne Gerät nimmt CPU', () =>
  expect(chooseBackend(parseDevices(fixture('list-devices-cpu')), false)).toBe('cpu'));

test('Vega-Laptop bekommt automatisch schnell', () => {
  const vram = parseDedicatedVram(fixture('reg-query-vega'));
  expect(vram).toBeLessThan(6144);
  expect(chooseSmoothingTier(parseDevices(fixture('list-devices-vega')), vram, 'auto')).toBe(
    'schnell',
  );
});

test('8-GB-Grafikkarte bekommt automatisch gründlich', () =>
  expect(chooseSmoothingTier([amd], parseDedicatedVram(fixture('reg-query-8gb')), 'auto')).toBe(
    'gruendlich',
  ));

test('NVIDIA bekommt automatisch gründlich', () =>
  expect(chooseSmoothingTier([nvidia], 0, 'auto')).toBe('gruendlich'));

test('Einstellung "schnell" schlägt starke Hardware', () =>
  expect(chooseSmoothingTier([nvidia], 8192, 'schnell')).toBe('schnell'));

test('Einstellung "gruendlich" schlägt schwache Hardware', () =>
  expect(chooseSmoothingTier([], 0, 'gruendlich')).toBe('gruendlich'));

test('Testmodus: feste Hardware ohne Prozesse', async () => {
  process.env.LETTERFLOW_FAKE_ENGINES = '1';
  try {
    expect(await detectHardware('auto')).toEqual({
      backend: 'cpu',
      tier: 'schnell',
      devices: [],
      dedicatedVramMiB: 0,
    });
  } finally {
    delete process.env.LETTERFLOW_FAKE_ENGINES;
  }
});
