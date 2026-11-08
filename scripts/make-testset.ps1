# Spike Parakeet: erzeugt testdata/testset/<id>.wav (16 kHz mono) per Windows-Sprachausgabe (TTS = Proxy, keine echte Sprache).
# Variante "<id>.wav": Sprachwechsel pro Phrase (Hedda de / Zira en). Variante "<id>h.wav": nur Hedda (deutscher Akzent auf Anglizismen).
Add-Type -AssemblyName System.Speech
$clips = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'bench-clips.json') | ConvertFrom-Json
$dir = Join-Path $PSScriptRoot '..\testdata\testset'
New-Item -ItemType Directory -Force $dir | Out-Null
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
function Render($name, $parts, $switch) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SetOutputToWaveFile((Join-Path (Resolve-Path $dir) "$name.wav"), $fmt)
  $pb = New-Object System.Speech.Synthesis.PromptBuilder
  foreach ($p in $parts) {
    $v = 'Microsoft Hedda Desktop'
    if ($switch -and $p[0] -eq 'en') { $v = 'Microsoft Zira Desktop' }
    if (-not $switch -and $p[0] -eq 'en' -and $name -like 'en*') { $v = 'Microsoft Zira Desktop' }
    $pb.StartVoice($v); $pb.AppendText($p[1]); $pb.EndVoice()
  }
  $s.Speak($pb); $s.Dispose()
}
foreach ($c in $clips) {
  Render $c.id $c.parts $true
  if ($c.cat -eq 'mixed') { Render ($c.id + 'h') $c.parts $false }
}
