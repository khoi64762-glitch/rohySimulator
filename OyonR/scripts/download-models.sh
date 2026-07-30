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

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

verify_sha256() {
  local file="$1" expected="$2"
  [[ -s "$file" ]] && [[ "$(sha256 "$file")" == "$expected" ]]
}

download() {
  local url="$1" dest="$2" label="$3" expected_sha="$4"
  local tmp="${dest}.part.$$"
  printf '→ %s\n' "$label"
  mkdir -p "$(dirname "$dest")"
  if [[ "$FORCE" -eq 0 ]] && verify_sha256 "$dest" "$expected_sha"; then
    local bytes
    bytes=$(wc -c < "$dest" | tr -d ' ')
    printf '  ✓ already present and verified (%s bytes)\n' "$bytes"
    return
  fi
  if [[ -e "$dest" ]]; then
    printf '  ↻ existing file is stale or invalid; replacing it\n'
  fi
  printf '  ↓ %s\n' "$url"
  if ! curl -fL --retry 3 --retry-all-errors --connect-timeout 20 \
    --progress-bar "$url" -o "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  if ! verify_sha256 "$tmp" "$expected_sha"; then
    printf '  ✗ checksum mismatch for %s\n' "$label" >&2
    rm -f "$tmp"
    return 1
  fi
  mv -f "$tmp" "$dest"
  printf '  ✓ saved to %s\n' "$dest"
}

# Verified upstream model URLs.
download \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  "$MODELS/mediapipe/face_landmarker.task" \
  "MediaPipe Face Landmarker (float16)" \
  "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/mobilevit_va_mtl.onnx" \
  "$MODELS/emotion/mobilevit_va_mtl.onnx" \
  "EmotiEffLib MobileViT MTL" \
  "93a2bee1f2e0b04e313c695078e9351c75e8fb4c457af4268a1716cb35601b0c"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/mbf_va_mtl.onnx" \
  "$MODELS/emotion/mbf_va_mtl.onnx" \
  "EmotiEffLib MobileFaceNet MTL" \
  "0323ace52ea6dbe9aa4a909d20933f7b8629c3fb41249e338f4316abf2a4828c"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b0_8_va_mtl.onnx" \
  "$MODELS/emotion/enet_b0_8_va_mtl.onnx" \
  "HSEmotion EfficientNet-B0 MTL" \
  "c43e056ad388d4a8dc911832b8291435b2af537f967e5870ebd731574ec7e812"

# Oyon v3 voice pipeline.
download \
  "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx" \
  "$MODELS/vad/silero_vad.onnx" \
  "Silero VAD v5.1.2 (ONNX)" \
  "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f"

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
  local tmp="${dest}.part.$$"
  printf '→ %s\n' "$label"
  if [[ "$FORCE" -eq 0 && -s "$dest" ]] && cmp -s "$src" "$dest"; then
    printf '  ✓ already present and matches installed peer\n'
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp -f "$src" "$tmp"
  mv -f "$tmp" "$dest"
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
  echo "  ✗ onnxruntime-web not found in node_modules — install cannot continue" >&2
  exit 1
fi

# MediaPipe tasks-vision. Vendor both its ESM loader and the matching WASM
# directory for the same-origin/air-gap runtime.
if mp_root="$(resolve_in_node_modules @mediapipe/tasks-vision)"; then
  copy_vendor "$mp_root/vision_bundle.mjs" "$VENDOR/mediapipe/vision_bundle.mjs" "mediapipe/vision_bundle.mjs"
  printf '→ %s\n' "@mediapipe/tasks-vision wasm"
  for src in "$mp_root/wasm"/*; do
    copy_vendor "$src" "$VENDOR/mediapipe/wasm/$(basename "$src")" \
      "mediapipe/wasm/$(basename "$src")"
  done
else
  echo "  ✗ @mediapipe/tasks-vision not found in node_modules — install cannot continue" >&2
  exit 1
fi

echo
echo "Done. Models live under standalone/models/ and standalone/vendor/."
