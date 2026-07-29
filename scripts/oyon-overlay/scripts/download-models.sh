#!/usr/bin/env bash
#
# Rohy overlay for Oyon's model downloader. In addition to the upstream
# models, Rohy must vendor the exact peer-dependency WASM/loader files for its
# same-origin and air-gapped deployment contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="$ROOT/standalone/models"
VENDOR="$ROOT/standalone/vendor"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

download() {
  local url="$1" dest="$2" label="$3"
  printf '→ %s\n' "$label"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" && -s "$dest" && "$FORCE" -eq 0 ]]; then
    local bytes
    bytes=$(wc -c < "$dest" | tr -d ' ')
    printf '  ✓ already present (%s bytes), skipping\n' "$bytes"
    return
  fi
  printf '  ↓ %s\n' "$url"
  curl -fL --progress-bar "$url" -o "$dest"
  printf '  ✓ saved to %s\n' "$dest"
}

# Verified upstream model URLs.
download \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  "$MODELS/mediapipe/face_landmarker.task" \
  "MediaPipe Face Landmarker (float16)"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mobilevit_va_mtl.onnx" \
  "$MODELS/emotion/mobilevit_va_mtl.onnx" \
  "EmotiEffLib MobileViT MTL"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mbf_va_mtl.onnx" \
  "$MODELS/emotion/mbf_va_mtl.onnx" \
  "EmotiEffLib MobileFaceNet MTL"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/enet_b0_8_va_mtl.onnx" \
  "$MODELS/emotion/enet_b0_8_va_mtl.onnx" \
  "HSEmotion EfficientNet-B0 MTL"

# Oyon v3 voice pipeline.
download \
  "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx" \
  "$MODELS/vad/silero_vad.onnx" \
  "Silero VAD v5.1.2 (ONNX)"

# Echo the first existing "<node_modules>/<rel>" among candidate roots. npm
# may hoist peers to the Rohy root or keep them under OyonR/node_modules.
resolve_in_node_modules() {
  local rel="$1" nm
  for nm in "$ROOT/../node_modules" "$ROOT/node_modules" "$ROOT/../../node_modules"; do
    if [[ -e "$nm/$rel" ]]; then
      printf '%s\n' "$nm/$rel"
      return 0
    fi
  done
  return 1
}

copy_vendor() {
  local src="$1" dest="$2" label="$3"
  printf '→ %s\n' "$label"
  if [[ -f "$dest" && -s "$dest" && "$FORCE" -eq 0 ]]; then
    printf '  ✓ already present, skipping\n'
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp -f "$src" "$dest"
  printf '  ✓ %s\n' "$dest"
}

# ONNX Runtime Web. Loader and WASM must come from the same resolved package;
# version skew fails silently in the browser. Rohy's release probes require
# both the standard and asyncify SIMD/threaded variants.
if ort_dist="$(resolve_in_node_modules onnxruntime-web/dist)"; then
  for f in ort.min.mjs \
           ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm \
           ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm; do
    copy_vendor "$ort_dist/$f" "$VENDOR/onnxruntime-web/$f" "onnxruntime-web/$f"
  done
else
  echo "  ⚠ onnxruntime-web not found in node_modules — run 'npm install' first (skipping ORT vendor)" >&2
fi

# MediaPipe tasks-vision. Vendor both its ESM loader and the matching WASM
# directory for the same-origin/air-gap runtime.
if mp_root="$(resolve_in_node_modules @mediapipe/tasks-vision)"; then
  copy_vendor "$mp_root/vision_bundle.mjs" "$VENDOR/mediapipe/vision_bundle.mjs" "mediapipe/vision_bundle.mjs"
  printf '→ %s\n' "@mediapipe/tasks-vision wasm"
  if [[ -d "$VENDOR/mediapipe/wasm" && "$FORCE" -eq 0 && -n "$(ls -A "$VENDOR/mediapipe/wasm" 2>/dev/null)" ]]; then
    printf '  ✓ already present, skipping\n'
  else
    mkdir -p "$VENDOR/mediapipe/wasm"
    cp -f "$mp_root/wasm"/* "$VENDOR/mediapipe/wasm/"
    printf '  ✓ %s\n' "$VENDOR/mediapipe/wasm"
  fi
else
  echo "  ⚠ @mediapipe/tasks-vision not found in node_modules (skipping MediaPipe vendor)" >&2
fi

echo
echo "Done. Models live under standalone/models/ and standalone/vendor/."
