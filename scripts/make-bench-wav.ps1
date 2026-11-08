# Erzeugt testdata/bench-10s.wav (16 kHz mono, ca. 10 s, DE/EN gemischt) per Windows-Sprachausgabe.
# Nur fuer Zeitmessung, nicht fuer Qualitaet.
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot '..\testdata\bench-10s.wav'
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($out, $fmt)
$pb = New-Object System.Speech.Synthesis.PromptBuilder
$pb.StartVoice('Microsoft Hedda Desktop'); $pb.AppendText('Ich schicke dir das Meeting Recap später, ähm, am Montag, nein, am Dienstag.'); $pb.EndVoice()
$pb.StartVoice('Microsoft Zira Desktop'); $pb.AppendText('Please merge the pull request today.'); $pb.EndVoice()
$s.Speak($pb)
$s.Dispose()
