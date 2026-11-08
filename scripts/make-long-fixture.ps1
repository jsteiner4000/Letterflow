# Erzeugt tests/fixtures/sprache-lang.wav (16 kHz mono 16 Bit): ein zusammenhängender Satz ohne Pause,
# das letzte Wort leiser.
Add-Type -AssemblyName System.Speech
$dir = Join-Path $PSScriptRoot '..\tests\fixtures'
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Hedda Desktop')
$s.Rate = 1
$s.SetOutputToWaveFile((Join-Path (Resolve-Path $dir) 'sprache-lang.wav'), $fmt)
$pb = New-Object System.Speech.Synthesis.PromptBuilder
$pb.AppendText('Heute Morgen habe ich mit meinen Kollegen über das neue Projekt gesprochen und wir wollen alles gleichmäßig verteilen, damit es rechtzeitig fertig wird, wirklich')
$pb.StartStyle((New-Object System.Speech.Synthesis.PromptStyle([System.Speech.Synthesis.PromptVolume]::ExtraSoft)))
$pb.AppendText('leise')
$pb.EndStyle()
$s.Speak($pb); $s.Dispose()
