# Messungen auf dem Entwickler-Laptop

Stand: 2026-11-08 · Task 1 · Version 0.0.1

Alle Zahlen stammen aus Läufen auf diesem Rechner (`scripts/bench.js`, je 5 Läufe nach einem Aufwärmlauf, Median). Nichts ist geschätzt, außer wo ausdrücklich „Schätzung" steht.

**Rechner:** Windows 11 Home, AMD Ryzen 7 7730U (8 Kerne / 16 Threads), 15 GiB RAM, Radeon Vega iGPU („AMD Radeon (TM) Graphics", Treiber 31.0.21925.1001), keine NVIDIA-Karte, keine NPU.

## Kurzfassung der Entscheidungen

| Frage | Entscheidung |
|---|---|
| Stufe dieses Laptops | **„schnell"** (~1,7B). Auch „schnell" verfehlt hier das Ziel von 2 s (siehe unten). |
| Schwelle „gründlich" in `chooseSmoothingTier` | **CUDA vorhanden ODER dediziertes VRAM ≥ 6144 MiB.** Nicht die von `llama-server --list-devices` gemeldete Größe nehmen (Vega meldet dort 8142 MiB, hat aber nur 512 MiB dediziert). |
| `timeoutMs` der Glättung | **5000 ms** für Stufe „schnell" (gemessenes Maximum 2,7 s). Für „gründlich" auf iGPU/CPU-Klasse wäre **10000 ms** nötig (Maximum 6,8 s). |
| Vulkan auf Vega stabil? | **Ja, stabil** (llama.cpp, 4 Modelle × 6 Anfragen, kein Absturz, kein Fehler). Aber **kein deutlicher Tempogewinn** gegenüber CPU (−15 % bis +13 %), daher läuft dieser Laptop effektiv auf CPU. |
| whisper.cpp Vulkan für Windows | **Kein offizielles Asset.** Offen, siehe Abschnitt „Offene Frage". |

## 1. Release-Assets (neueste Releases am 2026-11-08)

### whisper.cpp

- Die Tags `v1.9.x` (neuester `v1.9.5`) enthalten **keine** Assets. Die Binärdateien hängen an den Pre-Release-Tags `bNNNN`; neuester: **`b5454`** (2026-10-06).
- Windows-x64-Assets in `b5454`: `whisper-bin-x64.zip` (CPU, 8,5 MB), `whisper-blas-bin-x64.zip` (CPU + OpenBLAS), `whisper-bin-win-cuda-11.8.0-x64.zip` (272 MB), `whisper-bin-win-cuda-12.4.0-x64.zip` (653 MB).
- Weitere (nicht x64-Windows): `whisper-bin-Win32.zip`, `whisper-bin-win-cpu-arm64.zip`, `whisper-bin-win-cuda-13.4-arm64.zip`, `whisper-bin-win-opencl-adreno-arm64.zip`, Ubuntu x64/arm64, xcframework.
- **Es gibt kein Windows-x64-Vulkan-Asset.** Die ZIPs enthalten `Release/whisper-server.exe` (Unterordner `Release/`).

### llama.cpp (`b12207`, alle Releases sind als Pre-Release markiert)

- `llama-b12207-bin-win-cpu-x64.zip` (23,7 MB), `llama-b12207-bin-win-vulkan-x64.zip` (36,1 MB), `llama-b12207-bin-win-cuda-12.4-x64.zip` (275,5 MB) + `cudart-llama-bin-win-cuda-12.4-x64.zip` (373,3 MB), außerdem `cuda-13.5-x64` (163 MB) + `cudart-llama-bin-win-cuda-13.5-x64.zip` (406,6 MB), sycl, rocm, openvino, arm64-Varianten.
- Alle drei gewünschten Backends (cpu, vulkan, cuda) sind vorhanden; `llama-server.exe` liegt direkt im ZIP-Wurzelordner.
- `engines.json` enthält die Einträge mit URL, SHA-256 (GitHub-`digest`, für CPU/Vulkan nach Download nachgerechnet und identisch) und `exe`. CUDA-Einträge (12.4, nicht heruntergeladen, nicht testbar) stehen ebenfalls drin; `vulkan.whisper` ist `null`.

## 2. Modelle

Ablage: `%LOCALAPPDATA%\Letterflow\models`. SHA-256 nach dem Download selbst berechnet und mit den Hugging-Face-Angaben verglichen (identisch).

| Datei | Quelle | Größe | SHA-256 | Lizenz (laut Model Card) |
|---|---|---|---|---|
| `ggml-large-v3-turbo-q5_0.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin` | 574 041 195 B | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` | MIT |
| `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` („gründlich") | `https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf` | 2 497 281 120 B | `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597` | Apache-2.0 |
| `Qwen3-1.7B-Q4_K_M.gguf` („schnell") | `https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf` | 1 107 409 472 B | `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897` | Apache-2.0 |
| `Qwen3.5-4B-Q4_K_M.gguf` (Zusatzkandidat) | `https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf` | 2 740 937 888 B | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` | Apache-2.0 |
| `Qwen3.5-2B-Q4_K_M.gguf` (Zusatzkandidat) | `https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf` | 1 280 835 840 B | `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` | Apache-2.0 |

Hinweise:

- Die offiziellen `Qwen/…-GGUF`-Repos haben für diese Größen keine Q4_K_M-Datei (`Qwen/Qwen3-1.7B-GGUF` nur Q8_0; für Qwen3-4B-Instruct-2507 gibt es kein offizielles GGUF). Deshalb stammen die GGUFs von `unsloth` (Konvertierung; Lizenzfeld der Karte: `apache-2.0`). Die Original-Repos `Qwen/Qwen3.5-4B` und `Qwen/Qwen3.5-2B` stehen ebenfalls auf `apache-2.0`. Für die Originale von Qwen3-4B-Instruct-2507 und Qwen3-1.7B wurde nur das Lizenzfeld der unsloth-Karten geprüft.
- Neuere Apache/MIT-Modelle gleicher Größe mit Deutsch: **Qwen3.5** (2026-03, 2B und 4B) wurde als Zusatzkandidat mitgemessen. Neuere Qwen-Generationen (3.6/3.8) gibt es nur ab 27B bzw. als MoE, also zu groß.

## 3. whisper-server (b5454): API

- `GET /health` → `200 {"status":"ok"}`. **Ein `/health`-Endpunkt existiert.** Der Server lädt das Modell vor dem Lauschen, daher ist er sofort nach „bereit" erreichbar (Bereit-Zeit 0,7 s).
- `POST /inference` (multipart/form-data). Felder, **getestet**: `file` (WAV, 16 kHz), `temperature`, `response_format` (`json` → `{"text": "..."}`; `verbose_json` → Sprache, Dauer, Segmente mit Wörtern und Wahrscheinlichkeiten), `language` (`de` und `en`), `prompt` (Startprompt). Weitere Felder (`temperature_inc`, `translate` u. a.) wurden nicht einzeln geprüft. Der Text beginnt in `verbose_json` mit einem Leerzeichen und endet auf `\n`, also trimmen.
- `GET /` liefert eine kleine HTML-Testseite. Kein `/v1/audio/transcriptions` (404).
- Wichtige Startflags laut `--help`: `-m`, `--host`, `--port`, `-t`, `-l` (Standard `en`!), `-nt`, `--prompt`, `-ng` (GPU aus), `-dev N`, `-fa/-nfa` (Flash Attention, Standard an), `-ac N` (Audiokontext), `--vad`, `-vm`. Im Benchmark verwendet: `-t 8 -l de -nt --prompt "Ich schick dir das Meeting-Recap später." -ng`.
- Die Eingabe muss WAV sein (ohne `--convert`/ffmpeg).
- Das Binary lädt den CPU-Backend `ggml-cpu-haswell.dll` (kein Zen-4-Backend in diesem ZIP).

## 4. llama-server (b12207): `--list-devices`

Format (echte Ausgaben in `tests/fixtures/`):

```
Available devices:
  Vulkan0: AMD Radeon (TM) Graphics (8142 MiB, 7734 MiB free)
```

- Zeilenformat: `  <ID>: <Name> (<gesamt> MiB, <frei> MiB free)`, ID z. B. `Vulkan0`.
- Der **CPU-Build** gibt `Available devices:` gefolgt von `  (none)` aus (`tests/fixtures/list-devices-cpu.txt`).
- **Wichtig für Task 5:** Die 8142 MiB sind **gemeinsamer Systemspeicher** (rund die Hälfte der 15 GiB RAM). Die Vega hat laut Windows nur **512 MiB dediziert** (`HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0000`, `HardwareInformation.qwMemorySize` = 536870912; die 64-Bit-Variante ist nötig, `Win32_VideoController.AdapterRAM` ist 32 Bit und schneidet bei 4 GiB ab). Die Ausgabe von `--list-devices` enthält keinen Hinweis „integrated". Wer dort ≥ 6144 MiB prüft, würde die iGPU fälschlich als starke Hardware einstufen.
- Das Chat-Endpunkt-Verhalten (verwendet): `POST /v1/chat/completions` mit `temperature: 0`, `chat_template_kwargs: {"enable_thinking": false}`, `max_tokens`. Health: `GET /health`. Start mit `--jinja`, `-ngl 99` (Vulkan) bzw. `-ngl 0` (CPU), `-c 4096`, `-t 8`.
- Im Vulkan-Log: Warnung „Flash Attention over K/V rows … assigned to device CPU … set to disabled" (iGPU unterstützt es nicht; harmlos).

## 5. Messergebnisse

Testdaten: `testdata/bench-10s.wav` (10,3 s, 16 kHz mono, DE/EN-Mix per Windows-Sprachausgabe, erzeugt mit `scripts/make-bench-wav.ps1`; nur Zeit, nicht Qualität). Glättungstext: ca. 40 Wörter mit „ähm", Selbstkorrektur, Anglizismen; sechs Varianten (Lauf 0 Aufwärmen, 1–5 gemessen), damit kein Prompt-Cache die Zeit verfälscht; der System-Prompt bleibt gleich (wie in der App).

### 5.1 Spracherkennung (whisper-server, large-v3-turbo-q5_0)

| Backend | Konfiguration | Bereit nach | Median | Einzelläufe (ms) | Spitzen-RAM |
|---|---|---|---|---|---|
| CPU | 10 s WAV, `-t 8` | 0,77 s | **11 947 ms** | 11 947 / 11 643 / 11 688 / 12 300 / 12 285 | 752 MiB |
| CPU | 10 s WAV, `-t 16` (3 Läufe) | – | 12 531 ms | – | – |
| CPU | 10 s WAV, `-t 6` (3 Läufe) | – | 14 626 ms | – | – |
| CPU | **3 s** WAV, `-t 8` | – | **14 009 ms** | 13 083 / 13 628 / 14 009 / 14 241 / 14 411 | – |
| CPU | 10 s WAV, `-t 8 -ac 512` (3 Läufe) | – | **4 860 ms** | – | – |
| CPU | 3 s WAV, `-t 8 -ac 256` (3 Läufe) | – | **2 160 ms** | – | – |
| Vulkan | – | – | **nicht gemessen** (kein Asset) | – | – |

Erkenntnisse:

- Whisper rechnet das Encoder-Fenster immer über volle 30 s. Ein **3-s-Schnipsel dauert genauso lang (14 s) wie 10 s Audio (12 s)**. Das Zerlegen des Diktats an Sprechpausen bringt ohne Gegenmaßnahme keine Zeitersparnis pro Abschnitt.
- Mit verkürztem Audiokontext (`-ac`, Richtwert 1500 = 30 s; 512 ≈ 10 s, 256 ≈ 5 s) sinkt die Zeit stark (4,9 s bzw. 2,2 s). Der Kontext muss zur Abschnittslänge passen (Abschnitte ≤ 5 s bzw. ≤ 10 s). Der Erkennungstext war in beiden Fällen unverändert brauchbar; ob die Genauigkeit bei echter Sprache leidet, muss mit dem Testsatz (Task 8) geprüft werden. Whisper.cpp nennt `-ac` experimentell.
- Mehr Threads (16) helfen nicht, weniger (6) schaden: `-t 8` (= physische Kerne) bleibt richtig.
- Erkannter Text (Sprachvorgabe `-l de`): „Ich schicke dir das Meeting-Recap spheric. Ahm, am Montag. Nein, am Dienstag. Please merge the poll request today." Der englische Satz blieb trotz festem `de` englisch (nur ein synthetisches Beispiel, kein Beleg für Task 8; „ähm" wird als „Ahm" geschrieben, die Glättung muss das entfernen).

### 5.2 Glättung (llama-server, 40 Wörter, ca. 45 Ausgabe-Token)

Alle Werte in ms bzw. MiB, Median aus 5 Läufen. Ausgabe-Token im Median: 40–47.

| Modell | Backend | Bereit nach | Median | Schnellster / langsamster Lauf | Spitzen-RAM | GPU geteilt / dediziert |
|---|---|---|---|---|---|---|
| Qwen3-4B-Instruct-2507 | CPU | 3 662 | **4 708** | 4 675 / 5 867 | 4 748 | – |
| Qwen3-4B-Instruct-2507 | Vulkan | 5 626 | **5 190** | 5 019 / 6 194 | 3 530 | 3 398 / 18 |
| Qwen3-1.7B | CPU | 1 772 | **2 182** | 2 019 / 2 584 | 2 243 | – |
| Qwen3-1.7B | Vulkan | 2 842 | **2 460** | 2 088 / 2 687 | 1 951 | 1 825 / 39 |
| Qwen3.5-4B | CPU | 3 677 | **6 298** | 5 142 / 7 148 | 4 493 | – |
| Qwen3.5-4B | Vulkan | 5 734 | **5 707** | 5 569 / 6 779 | 3 867 | 3 571 / 20 |
| Qwen3.5-2B | CPU | 2 536 | **3 099** | 2 539 / 4 036 | 2 011 | – |
| Qwen3.5-2B | Vulkan | 2 727 | **2 621** | 2 222 / 2 657 | 1 991 | 1 793 / 61 |

Erkenntnisse:

- Die Erzeugung ist speicherbandbreiten-begrenzt: Qwen3-4B erzeugt ~10 Token/s (≈ 97 ms/Token), die Prompt-Verarbeitung läuft mit ~65 Token/s (laut `llama-server`-Log). Die iGPU nutzt denselben Arbeitsspeicher wie die CPU und bringt daher **keinen deutlichen Vorteil**: Vulkan ist bei Qwen3-4B (+10 %) und Qwen3-1.7B (+13 %) langsamer, bei Qwen3.5-4B (−9 %) und Qwen3.5-2B (−15 %) schneller; bei Letzteren streuen die CPU-Läufe stark (bis 7,1 s bzw. 4,0 s). Insgesamt kein klarer Vorteil.
- Die Vulkan-Modelle liegen im **geteilten** GPU-Speicher (3,4 GiB bei 4B), nicht im dedizierten (18–61 MiB). Das Einstellungsfenster darf hier nicht „x GiB VRAM" aus dem GPU-Zähler zeigen.
- Der Arbeitsspeicher-Bedarf (RAM, Spitze) von Whisper + Glättung zusammen: 752 + 2243 ≈ 3000 MiB („schnell", CPU) bzw. 752 + 4748 ≈ 5500 MiB („gründlich", CPU). Auf einem 15-GiB-Rechner unkritisch.
- Qualität (nur der jeweils letzte der fünf Läufe angesehen, keine Bewertung): Qwen3-4B-Instruct-2507 und Qwen3.5-4B setzen Satzzeichen, Groß-/Kleinschreibung und wenden die Selbstkorrektur an („am Donnerstag"). **Qwen3-1.7B** lässt Kleinschreibung und fehlende Satzzeichen stehen und wendet die Selbstkorrektur nicht an („am freitag nein am donnerstag"). **Qwen3.5-2B** formatiert korrekt, wendet die Korrektur aber falsch an („Am Freitag nicht am Donnerstag") und lässt „also halt" stehen. Das Qualitätsurteil trifft der Testsatz in Task 8; für „schnell" braucht es vermutlich einen strengeren Prompt oder ein anderes Modell.

### 5.3 Ende-zu-Ende (Schätzung aus den Messwerten)

Ziel laut Spec: unter 2 s von Loslassen bis Text bei 10 s Diktat mit Glättung. Aus den Messwerten ergibt sich (Schätzung, Summe von Teilmessungen):

| Weg | Whisper nach Loslassen | Glättung | Summe |
|---|---|---|---|
| Standard-Flags, ganzes Diktat | 11,9 s | 2,2 s (1,7B) | ≈ 14 s |
| `-ac 512`, ganzes Diktat | 4,9 s | 2,2 s | ≈ 7 s |
| Abschnitte während des Sprechens, letzter Rest ≤ 3 s mit `-ac 256` | 2,2 s | 2,2 s | ≈ 4,4 s |

(Der gemessene Glättungstext hat 40 Wörter; ein 10-s-Diktat sind etwa 25–30 Wörter, die Glättung dürfte entsprechend etwas kürzer dauern, wurde aber nicht gemessen.)

**Das 2-s-Ziel wird auf diesem Laptop nicht erreicht**, auch nicht mit „schnell". Realistisch sind ≈ 4–5 s. Wer schneller sein will, braucht GPU-Beschleunigung für Whisper (Vulkan-Build, siehe offene Frage), einen noch kleineren Whisper oder Glättung nur auf Wunsch.

## 6. Festlegungen

### 6.1 `chooseSmoothingTier` (Task 5)

- **„gründlich"** (Qwen3-4B-Instruct-2507, Q4_K_M), wenn **CUDA verfügbar** ist **oder** ein Gerät mit **dediziertem VRAM ≥ 6144 MiB** vorhanden ist.
- Sonst **„schnell"** (Qwen3-1.7B oder besserer ~2B-Kandidat nach Task 8).
- Das dedizierte VRAM muss aus der Windows-Registry (`HardwareInformation.qwMemorySize`, 64 Bit) oder DXGI kommen, **nicht** aus `llama-server --list-devices` (dort steht bei iGPUs der geteilte Speicher). Eine reine Vulkan-Zeile `VulkanN: … (N MiB, …)` darf nicht allein für die Stufe entscheiden.
- Zusätzlich Spec-Regel: Verfehlt „gründlich" das Tempo-Ziel (hier: 4B braucht allein für die Glättung 4,7–5,2 s), fällt der Rechner auf „schnell".
- **Dieser Laptop bekommt „schnell"** (512 MiB dediziert, kein CUDA; „gründlich" wäre allein bei der Glättung rund 2× langsamer als „schnell").

### 6.2 `timeoutMs` der Glättung (Task 9)

- **5000 ms** für „schnell": gemessenes Maximum 2,7 s (Vulkan) bzw. 2,6 s (CPU), also rund 1,9× Reserve; die Ausgabe wächst aber mit der Diktatlänge, daher Rettungsnetz, kein Normalfall.
- „Gründlich" auf CPU/iGPU (Maximum 6,2–7,1 s): 5000 ms würde regelmäßig greifen, dort **10000 ms** nötig. Auf Rechnern, die „gründlich" wirklich erreichen (CUDA/große GPU), bleiben 5000 ms. Das Zeitlimit und die Stufenwahl sollten zusammenpassen: greift es regelmäßig, wählt die App die kleinere Stufe (Spec).

### 6.3 Vulkan auf der Vega-iGPU

- `llama-server` (Vulkan, b12207) erkennt die Vega (`Vulkan0`), lädt alle vier Modelle mit `-ngl 99` und beantwortet 24 Anfragen ohne Absturz oder Fehlermeldung. **Stabil.**
- **Kein deutlicher Nutzen** gegenüber CPU (Abschnitt 5.2). Empfehlung für Task 4: Das Backend nicht nur nach „Selbsttest bestanden" wählen, sondern bei iGPU ohne dedizierten Speicher (< 6144 MiB dediziert) für die Glättung die CPU nehmen; die Hardware-Anzeige nennt dann „Prozessor". Whisper-Vulkan konnte nicht getestet werden (Windows-Build fehlt).

### 6.4 Sprachvorgabe (Task 8)

- Erste Beobachtung, kein Beschluss: Mit `-l de` blieb ein englischer Satz im Mix englisch; mit `language=en` und `prompt="Letterflow"` wurde „pull request" richtig erkannt. Der Vergleich `de` vs. `auto` gehört in den Testsatz mit echter Sprache.

## 7. Offene Frage: whisper.cpp unter Windows mit Vulkan

whisper.cpp liefert kein Windows-x64-Vulkan-Asset. Optionen, die den Controller/Julius entscheiden müssen (nicht ohne Rückfrage ausgeführt, weil mehrere GB Werkzeuge nötig sind):

1. Lokal bauen: Visual Studio Build Tools (C++-Workload), CMake, Vulkan SDK; `cmake -B build -DGGML_VULKAN=1 -DWHISPER_BUILD_SERVER=ON && cmake --build build --config Release`. Task 12 baut es ohnehin in der CI (`.github/workflows/build-engines.yml`).
2. Whisper auf dem Laptop bei CPU belassen (Messwerte oben) und Vulkan erst per CI-Build liefern. Da die Vega-iGPU bei llama.cpp keinen Vorteil bringt, ist offen, ob Whisper-Vulkan auf ihr schneller wäre (Encoder rechnet stärker, weniger bandbreitenbegrenzt; unbelegt).

## 8. Werkzeuge und Hinweise

- Node.js **26.13.0** (winget `OpenJS.NodeJS.LTS`), Pfad `C:\Program Files\nodejs\node.exe`; in bereits offenen Shells muss der PATH neu geladen werden.
- `scripts/fetch-engines.js` entpackt mit `System32\tar.exe`; das GNU-`tar` aus Git Bash scheitert an `C:`-Pfaden.
- PowerShell-Skripte sind auf diesem Rechner per Ausführungsrichtlinie gesperrt: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-bench-wav.ps1` (nur für den Aufruf, keine Systemeinstellung geändert).
- `testdata/bench-3s.wav` entstand durch Ausschneiden der letzten 3 s von `bench-10s.wav` (Datenteil beginnt bei Byte 46); die WAVs sind nicht eingecheckt.
- Rohdaten der Läufe: `test-results/bench.json` (nicht eingecheckt, per `node scripts/bench.js` reproduzierbar).
