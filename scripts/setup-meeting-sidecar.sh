#!/usr/bin/env bash
#
# setup-meeting-sidecar.sh — provisiona o venv Python do sidecar REAL de
# transcrição (captura de áudio PipeWire + faster-whisper STT pt-BR) e baixa os
# modelos ONNX da diarização (sherpa-onnx).
#
# IDEMPOTENTE: reexecutar reaproveita o venv existente, só reinstala o que falta
# e pula os modelos já baixados.
#
# Por que um venv dedicado (e não o Python do sistema):
#   - O Python do SISTEMA aqui é 3.14.x → INCOMPATÍVEL com torch/faster-whisper
#     (não há wheels). Criamos o venv com Python 3.12 via `uv`, que baixa o
#     interpretador correto automaticamente.
#   - A GPU é uma RTX 5070 Laptop (Blackwell, sm_120, 8GB). Wheels de torch para
#     Blackwell exigem CUDA 12.8 → instalamos torch pelo índice cu128. Em GPUs
#     antigas o cu128 também funciona; em máquinas sem GPU, o torch CPU ainda é
#     útil porque o sidecar faz fallback automático para CPU.
#
# DIARIZAÇÃO (quem falou) — sherpa-onnx (instalado via requirements.txt):
#   A diarização usa OfflineSpeakerDiarization do sherpa-onnx (ONNX Runtime puro,
#   sem torch/torchaudio, roda em CPU). Substituiu o pyannote.audio, que (1)
#   quebra com torchaudio 2.11 e (2) era GATED no Hugging Face (exigia token).
#   Os 2 modelos ONNX são LIVRES (sem token), baixados abaixo para
#   ${HOME}/.claude-manager/meeting-sidecar/models/. SEM os modelos, o sidecar
#   NÃO trava: emite um `error` de diarização e cai no comportamento sem speaker.
#   NÃO é mais necessário token HF, login no Hugging Face, nem aceitar termos.
#
# NÃO grava áudio nem roda o sidecar — só prepara o ambiente (venv + modelos).
#
# Após rodar: aponte a pref `meeting_sidecar_python` do app para o caminho do
# python impresso no fim (veja instruções no final).

set -euo pipefail

VENV_DIR="${HOME}/.claude-manager/meeting-sidecar/.venv"
MODELS_DIR="${HOME}/.claude-manager/meeting-sidecar/models"
PY_VERSION="3.12"
TORCH_INDEX="https://download.pytorch.org/whl/cu128"

# Modelos ONNX da diarização (livres — k2-fsa/sherpa-onnx releases).
SEG_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx"
SEG_MODEL="${MODELS_DIR}/sherpa-onnx-pyannote-segmentation-3-0/model.onnx"
EMB_MODEL="${MODELS_DIR}/nemo_en_titanet_small.onnx"

# Diretório deste script → raiz do repo (para achar sidecar/requirements.txt).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REQUIREMENTS="${REPO_ROOT}/sidecar/requirements.txt"

echo "==> Meeting sidecar setup"
echo "    venv:        ${VENV_DIR}"
echo "    models:      ${MODELS_DIR}"
echo "    python:      ${PY_VERSION} (baixado pelo uv)"
echo "    torch index: ${TORCH_INDEX} (CUDA 12.8 / Blackwell)"
echo

# --- uv (gerenciador do venv) ---------------------------------------------
if ! command -v uv >/dev/null 2>&1; then
  # uv costuma estar em ~/.local/bin; garante no PATH para esta sessão.
  export PATH="${HOME}/.local/bin:${PATH}"
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "ERRO: 'uv' não encontrado. Instale com:" >&2
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi
echo "==> uv: $(uv --version)"

# --- venv (idempotente) ----------------------------------------------------
mkdir -p "$(dirname "${VENV_DIR}")"
if [ -x "${VENV_DIR}/bin/python" ]; then
  echo "==> venv já existe — reaproveitando"
else
  echo "==> criando venv com Python ${PY_VERSION}"
  uv venv --python "${PY_VERSION}" "${VENV_DIR}"
fi

VENV_PY="${VENV_DIR}/bin/python"

# `uv pip install --python <venv_py>` instala DENTRO do venv sem precisar de
# `source activate`. Idempotente: pula o que já está satisfeito.

# --- torch (índice CUDA 12.8) ---------------------------------------------
# Instalado ANTES do faster-whisper para fixar a build cu128 (evita o resolver
# do faster-whisper puxar um torch do PyPI sem CUDA). torchaudio NÃO é instalado:
# o faster-whisper não precisa dele e a diarização agora é sherpa-onnx (sem torch).
echo "==> instalando torch (cu128 / Blackwell)"
# torch==2.11.0: versão validada na RTX 5070 Laptop (Blackwell, sm_120) com o
# índice cu128. Pin exato p/ reprodutibilidade — versões mais novas podem mudar
# o ABI de CUDA/wheels.
uv pip install --python "${VENV_PY}" --index-url "${TORCH_INDEX}" torch==2.11.0

# --- faster-whisper + soundfile + numpy + sherpa-onnx ----------------------
# sherpa-onnx (diarização) está no requirements.txt — lib isolada (ONNX Runtime),
# não puxa torch. Reusa o torch cu128 já instalado acima para o faster-whisper.
echo "==> instalando faster-whisper + soundfile + numpy + sherpa-onnx"
uv pip install --python "${VENV_PY}" -r "${REQUIREMENTS}"

# --- modelos ONNX da diarização (livres, sem token) ------------------------
# Idempotente: pula se já existem. A segmentation vem num .tar.bz2 que expande
# para uma pasta com model.onnx; a embedding é um .onnx único.
mkdir -p "${MODELS_DIR}"

if [ -f "${SEG_MODEL}" ]; then
  echo "==> modelo de segmentation já existe — pulando"
else
  echo "==> baixando modelo de segmentation (pyannote-3.0, ~6.6MB)"
  curl -fL --retry 3 -o "${MODELS_DIR}/segmentation.tar.bz2" "${SEG_URL}"
  tar -xjf "${MODELS_DIR}/segmentation.tar.bz2" -C "${MODELS_DIR}"
  rm -f "${MODELS_DIR}/segmentation.tar.bz2"
fi

if [ -f "${EMB_MODEL}" ]; then
  echo "==> modelo de embedding já existe — pulando"
else
  echo "==> baixando modelo de embedding (NeMo TitaNet small, ~38MB)"
  curl -fL --retry 3 -o "${EMB_MODEL}" "${EMB_URL}"
fi

# --- modelo large-v3 -------------------------------------------------------
# O faster-whisper baixa o large-v3 (~3GB) sob demanda no 1º uso e cacheia em
# ~/.cache/huggingface. Para pré-baixar agora (recomendado p/ não travar a 1ª
# reunião), descomente o bloco abaixo. Mantido OPT-IN por ser download pesado.
#
# echo "==> pré-baixando o modelo large-v3 (~3GB)"
# "${VENV_PY}" - <<'PY'
# from faster_whisper import WhisperModel
# WhisperModel("large-v3", device="cpu", compute_type="int8")
# print("modelo large-v3 em cache")
# PY

echo
echo "==> Pronto. Python do venv:"
echo "${VENV_PY}"
echo
echo "Próximo passo — apontar o app para este Python (uma das opções):"
echo "  1) No app: Preferências → defina 'meeting_sidecar_python' = ${VENV_PY}"
echo "  2) Via DevTools/console do renderer:"
echo "       window.api.prefs.set('meeting_sidecar_python', '${VENV_PY}')"
echo
echo "O modelo large-v3 (~3GB) será baixado no 1º uso, salvo se você"
echo "descomentar o bloco de pré-download acima."
echo
echo "Diarização (quem falou): modelos ONNX livres baixados em:"
echo "  ${MODELS_DIR}"
echo "NÃO é necessário token do Hugging Face nem aceitar termos. Se os modelos"
echo "faltarem, a transcrição funciona normalmente — só sem speaker."
