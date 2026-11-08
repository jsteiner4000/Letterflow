// Baut den nativen Helfer mit dem Compiler, der in Windows (.NET Framework 4) bereits enthalten ist.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fw = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = path.join(fw, 'csc.exe');
const wpf = path.join(fw, 'WPF'); // dort liegen die UI-Automation-Assemblies
if (!fs.existsSync(csc)) {
  console.error('csc.exe nicht gefunden: ' + csc);
  process.exit(1);
}
const out = path.join(root, 'resources', 'bin', 'letterflow-helper.exe');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(
  csc,
  [
    '/nologo',
    '/codepage:65001',
    '/target:winexe',
    '/optimize+',
    '/r:' + path.join(wpf, 'UIAutomationClient.dll'),
    '/r:' + path.join(wpf, 'UIAutomationTypes.dll'),
    '/r:' + path.join(wpf, 'WindowsBase.dll'),
    '/out:' + out,
    path.join(root, 'native', 'LetterflowHelper.cs'),
  ],
  { stdio: 'inherit' },
);
console.log('Gebaut: ' + out);
