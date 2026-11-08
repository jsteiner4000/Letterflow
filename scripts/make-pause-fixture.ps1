# Erzeugt tests/fixtures/sprache-pause-sprache.wav (16 kHz mono 16 Bit): "Hallo zusammen" / 1,5 s Stille / "bis später".
Add-Type -AssemblyName System.Speech
$dir = Join-Path $PSScriptRoot '..\tests\fixtures'
New-Item -ItemType Directory -Force $dir | Out-Null
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Hedda Desktop')
$s.SetOutputToWaveFile((Join-Path (Resolve-Path $dir) 'sprache-pause-sprache.wav'), $fmt)
$pb = New-Object System.Speech.Synthesis.PromptBuilder
$pb.AppendText('Hallo zusammen')
$pb.AppendBreak([TimeSpan]::FromMilliseconds(1500))
$pb.AppendText('bis später')
$s.Speak($pb); $s.Dispose()
