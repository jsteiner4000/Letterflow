# Erzeugt tests/fixtures/diktat-kurz.wav (16 kHz mono 16 Bit): kurzer Satz für den Diktat-Ablauf.
# Chromium spielt die Datei als Test-Mikrofon in Schleife ab, daher wird die Stille am Ende auf
# 100 ms gekürzt: so liefert jedes Zeitfenster ab etwa 1 s sicher Sprache.
Add-Type -AssemblyName System.Speech
$dir = Join-Path $PSScriptRoot '..\tests\fixtures'
New-Item -ItemType Directory -Force $dir | Out-Null
$f = Join-Path (Resolve-Path $dir) 'diktat-kurz.wav'
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Hedda Desktop')
$s.SetOutputToWaveFile($f, $fmt)
$s.Speak('Hallo Tim, wie geht es dir?'); $s.Dispose()

$b = [IO.File]::ReadAllBytes($f)
$chunk = 12
while ([Text.Encoding]::ASCII.GetString($b, $chunk, 4) -ne 'data') { $chunk += 8 + [BitConverter]::ToInt32($b, $chunk + 4) }
$daten = $chunk + 8
$ende = $b.Length - 2
while ($ende -gt $daten -and [Math]::Abs([BitConverter]::ToInt16($b, $ende)) -lt 30) { $ende -= 2 }
$ende = [Math]::Min($b.Length, $ende + 2 + 3200)
$neu = New-Object byte[] $ende
[Array]::Copy($b, $neu, $ende)
[BitConverter]::GetBytes([int]($ende - 8)).CopyTo($neu, 4)
[BitConverter]::GetBytes([int]($ende - $daten)).CopyTo($neu, $chunk + 4)
[IO.File]::WriteAllBytes($f, $neu)
