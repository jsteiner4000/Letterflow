# Drittanbieter-Software und -Modelle

Folgende Bestandteile stammen von Dritten:

| Bestandteil | Lizenz | Quelle |
|---|---|---|
| Electron | MIT | https://github.com/electron/electron |
| sherpa-onnx (sherpa-onnx-node) | Apache 2.0 | https://github.com/k2-fsa/sherpa-onnx |
| llama.cpp (llama-server) | MIT | https://github.com/ggml-org/llama.cpp |
| LLVM OpenMP (in den llama.cpp-Paketen) | Apache 2.0 mit LLVM-Ausnahme | https://openmp.llvm.org |
| NVIDIA Parakeet TDT 0.6B v3 (Modell) | CC BY 4.0 | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 |
| Qwen3-4B-Instruct-2507 (Modell) | Apache 2.0 | https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507 |
| Qwen3-1.7B (Modell) | Apache 2.0 | https://huggingface.co/Qwen/Qwen3-1.7B |
| Inter (Schrift) | SIL OFL 1.1 | https://github.com/rsms/inter |
| Outfit (Schrift) | SIL OFL 1.1 | https://github.com/Outfitio/Outfit-Fonts |
| Newsreader (Schrift) | SIL OFL 1.1 | https://github.com/productiontype/Newsreader |

## Spracherkennung: NVIDIA Parakeet

Modell von NVIDIA (https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). int8-ONNX-Export vom sherpa-onnx-Projekt, unverändert verwendet.

## Textglättung: Qwen3

Qwen3-4B-Instruct-2507 („Gründlich“) und Qwen3-1.7B („Ausgewogen“, Denkmodus abgeschaltet) des Qwen-Teams (Alibaba Cloud), Apache 2.0. Verwendet werden die quantisierten GGUF-Fassungen (Q4_K_M) von Unsloth.

## Lizenztexte

- MIT, Apache 2.0, CC BY 4.0: vollständig unter den oben genannten Quellen.
- Die Lizenztexte der Schriften liegen dem Programm bei (`src/renderer/fonts/*/OFL.txt`).
- Die Modelle werden beim ersten Start von Hugging Face geladen und nicht mit dem Installer ausgeliefert.
