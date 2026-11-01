#!/bin/sh
# Optional: local fallback for when Codex realtime voice is not available (whisper for hearing, system speech for talking).
set -eu
DIR="${RORSCHACH_WHISPER_DIR:-$HOME/.cache/rorschach/models}"
MODEL=ggml-small-q5_1.bin
if ! command -v whisper-cli >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || { echo "先安装 whisper.cpp，让 whisper-cli 进入 PATH" >&2; exit 1; }
  brew install whisper-cpp
fi
mkdir -p "$DIR"
if [ ! -f "$DIR/$MODEL" ]; then
  curl -L -C - --http1.1 --retry 8 --retry-delay 5 -o "$DIR/$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL"
  mv "$DIR/$MODEL.part" "$DIR/$MODEL"
fi
echo "本地语音已就绪：$DIR/$MODEL"
