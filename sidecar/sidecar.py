#!/usr/bin/env python3
"""Sidecar REAL da Meeting Intelligence: captura de áudio (PipeWire) + STT pt-BR
(faster-whisper) emitindo o MESMO protocolo NDJSON do fake_sidecar.py.

Diferenças vs o fake:
  - Captura áudio do sistema (monitor do sink default = vozes dos outros) + mic
    (você) via `pw-record` + `wpctl`/`pw-cli` — SEM ffmpeg/pactl/parec.
  - Transcreve com faster-whisper large-v3, language='pt', VAD, em GPU (CUDA)
    com fallback automático para CPU se o CUDA estiver indisponível/incompatível.
  - DIARIZAÇÃO (quem falou) PÓS-captura: roda sherpa-onnx
    (OfflineSpeakerDiarization) sobre o WAV completo e atribui um `speaker_label`
    (SPEAKER_00/01…) a cada segment por maior overlap temporal segment↔turno. O
    speaker predominante da TRILHA DO MIC é marcado `is_local_user` (a captura em
    2 trilhas separadas identifica "você" deterministicamente). Diarização é
    OPCIONAL: precisa de 2 modelos ONNX locais (segmentation pyannote-3.0 +
    embedding TitaNet). Sem a lib/modelos, o sidecar emite um `error` claro e cai
    no comportamento antigo (segments sem speaker) — NÃO trava. NÃO há token HF
    nem modelo gated: os modelos ONNX são livres (k2-fsa/sherpa-onnx releases),
    rodam em CPU e são isolados (sem torch/torchaudio).

Por que sherpa-onnx e não pyannote.audio/whisperX: pyannote.audio 3.4 quebra com
torchaudio 2.11 (exigido pela GPU Blackwell/cu128 — removeu AudioMetaData) e é
gated no HF. whisperX empacota o próprio pipeline de STT (reimplementa a
transcrição), arrastando um 2º caminho de STT divergente do faster-whisper. O
sherpa-onnx é uma lib isolada (ONNX Runtime, sem torch), com modelos livres, e
seu resultado (turnos start/end/speaker) casa por timestamp com a transcrição
do faster-whisper intocada — o caminho mais simples e robusto.

Contrato NDJSON (stdout, 1 evento por linha, flush=True) — superset do fake:
  {"type":"status","state":"capturing"|"transcribing"|"diarizing"|...}
  {"type":"speaker","label":"SPEAKER_00","is_local_user":true|false}
  {"type":"segment","idx":N,"start_ms":..,"end_ms":..,"speaker":"SPEAKER_0X"|null,
   "text":"...","confidence":<float|null>}
  {"type":"done","segments":N,"duration_ms":...}
  {"type":"error","message":"..."}

Os eventos `speaker` (quando a diarização roda) precedem os `segment` que os
referenciam, pra que o consumidor já conheça o is_local_user de cada label.

stderr = só log legível (device, VRAM, progresso). stdout = SÓ NDJSON.
SIGINT/SIGTERM = stop graceful (para a captura, transcreve o que já gravou,
emite `done`). Orphan-guard: stdin fecha (main morreu) → auto-encerra, liberando
o device de áudio.

Modos:
  --audio-file <wav>  MODO TESTE/OFFLINE: pula a captura e transcreve um WAV
                      existente, emitindo todos os segments + done. OBRIGATÓRIO
                      para validação sem hardware/áudio ao vivo. Caminho BATCH
                      puro (sem janelas ao vivo).
  (sem --audio-file)  Captura 2 trilhas (monitor + mic) com pw-record em paralelo
                      e transcreve AO VIVO por janelas: a cada ~WINDOW_SEC lê a
                      janela NOVA de áudio já gravado, transcreve e emite os
                      `segment` provisórios (is_partial via NDJSON `partial`)
                      com start_ms ABSOLUTO. No stop, faz uma passada FINAL sobre
                      o mix completo e reconcilia (emite os `segment` finais).

Decisão de design (ao-vivo por janelas): a captura grava as 2 trilhas em arquivos
temporários numa thread dedicada; a thread principal roda um loop de transcrição
que lê o áudio JÁ gravado a partir de um offset (samples já processados), mixa a
janela nova e a transcreve com faster-whisper, emitindo segments provisórios com
timestamp absoluto. O modelo é carregado UMA vez e reusado por todas as janelas
+ a passada final. CUIDADO crítico: `_stop` encerra a CAPTURA, não a transcrição
— o loop NÃO faz `if _stop.is_set(): break` (isso zerava os segments). Após o
stop, drena o resto e roda a passada FINAL sobre o mix completo, substituindo os
provisórios pelos finais (a UI reconcilia por idx). `--audio-file` continua sendo
batch puro e exercita o mesmo caminho de STT (load do modelo + transcribe).
"""

import argparse
import ctypes
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time

# Taxa de amostragem alvo do STT. faster-whisper espera 16kHz mono.
TARGET_SR = 16000

# Cadência do transcript ao vivo: a cada WINDOW_SEC de áudio NOVO acumulado, a
# janela é transcrita e emitida como provisória. 7s equilibra latência percebida
# (segments aparecendo) vs. ter contexto suficiente p/ o VAD/whisper não picotar
# palavras. MIN_WINDOW_SEC evita transcrever janelas minúsculas (ruído/custo).
WINDOW_SEC = 7.0
MIN_WINDOW_SEC = 2.5


# ---------------------------------------------------------------------------
# NDJSON / logging
# ---------------------------------------------------------------------------


def emit(event):
    sys.stdout.write(json.dumps(event, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write(f"[sidecar] {msg}\n")
    sys.stderr.flush()


# Sinaliza encerramento gracioso (SIGINT/SIGTERM ou stdin fechado). A captura ao
# vivo observa este Event para parar as gravações antes de transcrever.
_stop = threading.Event()


def _on_signal(_signum, _frame):
    log("sinal de parada recebido — encerrando graciosamente")
    _stop.set()


def _watch_stdin_closed():
    """Orphan-guard: o main mantém o stdin (pipe) aberto. Quando ele morre, o
    pipe fecha e readline() retorna EOF — então auto-encerramos, liberando o
    device de áudio."""
    try:
        while sys.stdin.readline():
            pass
    except (ValueError, OSError):
        pass
    if not _stop.is_set():
        log("stdin fechado (parent morreu) — auto-encerrando")
        _stop.set()


# ---------------------------------------------------------------------------
# Descoberta de devices PipeWire (wpctl / pw-cli) — SEM pactl/parec
# ---------------------------------------------------------------------------


def _run(cmd, timeout=10):
    """Roda um comando e devolve (rc, stdout, stderr). Tolerante a binário
    ausente (FileNotFoundError → rc=127)."""
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except FileNotFoundError:
        return 127, "", f"binário não encontrado: {cmd[0]}"
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout: {' '.join(cmd)}"


def _default_sink_node_name():
    """Nome do node do sink default via `wpctl inspect @DEFAULT_AUDIO_SINK@`
    (campo node.name). pw-record usa esse nome + sufixo `.monitor` para capturar
    o que está TOCANDO no sistema (as vozes dos outros na call)."""
    rc, out, _ = _run(["wpctl", "inspect", "@DEFAULT_AUDIO_SINK@"])
    if rc != 0:
        return None
    for line in out.splitlines():
        line = line.strip()
        # Linha típica: `* node.name = "alsa_output.pci-...analog-stereo"`
        if "node.name" in line and "=" in line:
            value = line.split("=", 1)[1].strip().strip("*").strip()
            return value.strip('"')
    return None


def _default_source_node_name():
    """Nome do node do source default (o mic) via
    `wpctl inspect @DEFAULT_AUDIO_SOURCE@`."""
    rc, out, _ = _run(["wpctl", "inspect", "@DEFAULT_AUDIO_SOURCE@"])
    if rc != 0:
        return None
    for line in out.splitlines():
        line = line.strip()
        if "node.name" in line and "=" in line:
            value = line.split("=", 1)[1].strip().strip("*").strip()
            return value.strip('"')
    return None


def _resolve_capture_targets():
    """Resolve os dois targets do pw-record:
      - monitor: `<sink node.name>.monitor` (saída do sistema = vozes dos outros)
      - mic:     `<source node.name>`        (sua voz)

    Retorna (monitor_target, mic_target). Qualquer um pode ser None se o device
    não for descoberto — o chamador decide o que é fatal."""
    sink = _default_sink_node_name()
    monitor = f"{sink}.monitor" if sink else None
    mic = _default_source_node_name()
    return monitor, mic


# ---------------------------------------------------------------------------
# Captura com pw-record (2 trilhas em WAV temporário)
# ---------------------------------------------------------------------------


def _set_pdeathsig():
    """preexec_fn (filho): pede ao kernel um SIGTERM no filho assim que o pai
    (este python) morrer — incl. SIGKILL no python (killAllSidecars no quit/crash).
    Sem isto, o pw-record reparenta pro init e segura o sink-monitor + mic
    indefinidamente. PR_SET_PDEATHSIG=1. Best-effort: silencia em libc ausente."""
    try:
        ctypes.CDLL("libc.so.6", use_errno=True).prctl(1, signal.SIGTERM)
    except Exception:
        pass


def _spawn_pw_record(target, out_path):
    """Inicia `pw-record` gravando `target` em `out_path` (WAV). pw-record grava
    até receber SIGINT/SIGTERM. `--target` aceita o node.name resolvido.
    Retorna o Popen ou None se o binário não existir."""
    cmd = [
        "pw-record",
        "--target",
        target,
        # Mono 16kHz já na captura reduz o trabalho de reamostragem; se o device
        # não suportar, soundfile reamostra na leitura.
        "--rate",
        str(TARGET_SR),
        "--channels",
        "1",
        "--format",
        "s16",
        out_path,
    ]
    try:
        # stdin=DEVNULL: pw-record não lê stdin. stdout/stderr → DEVNULL: o áudio
        # vai pro ARQUIVO out_path; DEVNULL evita poluir o NDJSON E elimina o
        # deadlock de PIPE (~64KB) que ninguém drena em sessão longa. A morte
        # precoce é detectada via proc.poll(), não por ler stderr.
        # preexec_fn=_set_pdeathsig: pw-record recebe SIGTERM quando o python morre.
        return subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            preexec_fn=_set_pdeathsig,
        )
    except FileNotFoundError:
        return None


def _stop_proc(proc, grace=3.0):
    if proc is None or proc.poll() is not None:
        return
    proc.send_signal(signal.SIGINT)
    try:
        proc.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=grace)


def start_capture_tracks(out_dir):
    """Faz spawn das gravações (monitor + mic) e retorna (tracks_vivos, paths) SEM
    bloquear até o stop — o caller roda a transcrição ao vivo em paralelo e só
    depois para os procs. `tracks_vivos` é lista de (proc, path, kind), preservando
    QUAL trilha é o mic (necessário pro is_local_user da diarização); `paths` os
    caminhos das trilhas que efetivamente subiram. Levanta RuntimeError se NENHUM
    device subir (o caller é dono de parar os procs no erro/fim)."""
    monitor_target, mic_target = _resolve_capture_targets()
    log(f"targets de captura: monitor={monitor_target!r} mic={mic_target!r}")

    os.makedirs(out_dir, exist_ok=True)
    tracks = []  # (proc, path, kind)

    if monitor_target:
        p = os.path.join(out_dir, "monitor.wav")
        proc = _spawn_pw_record(monitor_target, p)
        if proc:
            tracks.append((proc, p, "monitor"))
        else:
            log("pw-record ausente — não foi possível capturar o monitor")
    else:
        log("monitor source não descoberto (sink default ausente?)")

    if mic_target:
        p = os.path.join(out_dir, "mic.wav")
        proc = _spawn_pw_record(mic_target, p)
        if proc:
            tracks.append((proc, p, "mic"))
        else:
            log("pw-record ausente — não foi possível capturar o mic")
    else:
        log("mic source não descoberto (source default ausente?)")

    if not tracks:
        raise RuntimeError(
            "nenhum device de áudio capturável (verifique pw-record e os "
            "devices default do PipeWire via `wpctl status`)"
        )

    # Detecta falha imediata de um pw-record (ex.: target inválido) sem abortar a
    # captura inteira se a OUTRA trilha estiver de pé. stderr é DEVNULL; o motivo
    # da morte sai do rc + log do pw-record.
    time.sleep(0.4)
    alive = []
    for proc, path, kind in tracks:
        if proc.poll() is not None:
            log(f"trilha {kind} morreu ao iniciar (rc={proc.returncode})")
        else:
            alive.append((proc, path, kind))

    if not alive:
        for proc, _p, _k in tracks:
            _stop_proc(proc)
        raise RuntimeError(
            "todas as trilhas de captura falharam ao iniciar (target inválido?)"
        )

    log(f"capturando {len(alive)} trilha(s) ao vivo")
    emit({"type": "status", "state": "capturing"})
    return alive, [path for _proc, path, _kind in alive]


def stop_capture_tracks(tracks):
    """Para todos os pw-record (SIGINT → timeout → SIGKILL). No-op em proc já
    morto. Defesa: o caller chama no finally pra nenhum pw-record sobreviver."""
    for proc, _path, _kind in tracks:
        _stop_proc(proc)


# ---------------------------------------------------------------------------
# Mix em numpy + soundfile (SEM ffmpeg)
# ---------------------------------------------------------------------------


def _read_mono(path, target_sr):
    """Lê um WAV via soundfile, downmixa pra mono e reamostra pra `target_sr` com
    interpolação linear (numpy puro, sem scipy/ffmpeg). Retorna float32 [-1,1]."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)  # downmix
    if sr != target_sr and mono.size > 0:
        # Reamostragem linear: suficiente p/ STT (whisper é robusto). Evita scipy.
        duration = mono.size / float(sr)
        n_out = max(1, int(round(duration * target_sr)))
        x_old = np.linspace(0.0, duration, num=mono.size, endpoint=False)
        x_new = np.linspace(0.0, duration, num=n_out, endpoint=False)
        mono = np.interp(x_new, x_old, mono).astype(np.float32)
    return mono


def _read_mono_16k(path):
    """Lê um WAV em mono float32 16kHz (taxa-alvo do STT). Atalho de _read_mono."""
    return _read_mono(path, TARGET_SR)


def _mix_arrays(tracks):
    """Soma N arrays mono (zero-pad ao mais longo) e normaliza p/ evitar clipping.
    Retorna float32 mono (vazio se não houver trilha)."""
    import numpy as np

    tracks = [t for t in tracks if t.size > 0]
    if not tracks:
        return np.zeros(0, dtype=np.float32)
    length = max(t.size for t in tracks)
    acc = np.zeros(length, dtype=np.float32)
    for t in tracks:
        if t.size < length:
            t = np.pad(t, (0, length - t.size))
        acc += t
    peak = float(np.max(np.abs(acc))) if acc.size else 0.0
    if peak > 1.0:
        acc = acc / peak
    return acc


def _read_mix_16k(paths):
    """Lê e mixa as trilhas atuais (best-effort: trilha ainda sendo gravada pode
    falhar a leitura num instante; ignoramos e seguimos com as legíveis). Retorna
    float32 mono 16kHz. Usado pelas janelas ao vivo, que leem WAVs em escrita."""
    import numpy as np

    arrays = []
    for p in paths:
        try:
            arrays.append(_read_mono_16k(p))
        except Exception as e:  # noqa: BLE001
            log(f"leitura parcial de {p} falhou (em escrita?): {e}")
    return _mix_arrays(arrays) if arrays else np.zeros(0, dtype=np.float32)


def mix_tracks_to_wav(paths, out_path):
    """Lê N trilhas, alinha pelo comprimento (zero-pad), soma e normaliza pra
    evitar clipping. Escreve um WAV 16kHz mono. Retorna out_path."""
    import soundfile as sf

    tracks = [_read_mono_16k(p) for p in paths]
    acc = _mix_arrays(tracks)
    if acc.size == 0:
        raise RuntimeError("trilhas vazias após decodificação")

    sf.write(out_path, acc, TARGET_SR, subtype="PCM_16")
    log(f"mix escrito: {out_path} ({acc.size / TARGET_SR:.1f}s)")
    return out_path


# ---------------------------------------------------------------------------
# STT com faster-whisper (GPU → fallback CPU)
# ---------------------------------------------------------------------------


def _pick_device():
    """Decide (device, compute_type). Tenta CUDA; se torch não vê CUDA ou a
    inicialização falhar (Blackwell/sm_120 sem wheels cu128 → torch sem CUDA),
    cai pra CPU. compute_type int8_float16 na GPU (cabe nos 8GB), int8 na CPU."""
    try:
        import torch  # noqa: F401

        if torch.cuda.is_available():
            try:
                name = torch.cuda.get_device_name(0)
                cap = torch.cuda.get_device_capability(0)
                free, total = torch.cuda.mem_get_info()
                log(
                    f"CUDA disponível: {name} sm_{cap[0]}{cap[1]} "
                    f"VRAM livre={free / 1e9:.1f}GB/{total / 1e9:.1f}GB"
                )
                return "cuda", "int8_float16"
            except Exception as e:  # noqa: BLE001
                log(f"CUDA presente mas inicialização falhou ({e}) — caindo pra CPU")
        else:
            log("torch sem CUDA disponível — usando CPU")
    except Exception as e:  # noqa: BLE001
        log(f"torch indisponível/erro ({e}) — usando CPU")
    return "cpu", "int8"


def load_model():
    """Carrega o WhisperModel large-v3 (pt) uma única vez. GPU → fallback CPU.
    Robustez Blackwell: se a inicialização na GPU explodir (kernel incompatível em
    runtime, não pego por cuda.is_available), reinicia na CPU. Retorna o modelo;
    levanta se até a CPU falhar."""
    from faster_whisper import WhisperModel

    device, compute_type = _pick_device()

    def _load(dev, ct):
        log(f"carregando WhisperModel large-v3 (device={dev}, compute={ct})")
        return WhisperModel("large-v3", device=dev, compute_type=ct)

    try:
        return _load(device, compute_type)
    except Exception as e:  # noqa: BLE001
        if device != "cpu":
            log(f"falha ao carregar na GPU ({e}) — fallback CPU")
            return _load("cpu", "int8")
        raise


def _confidence(avg_logprob):
    if avg_logprob is None:
        return None
    import math

    # avg_logprob (log-prob) → ~[0,1] só pra UI; não é probabilidade real.
    return round(float(math.exp(avg_logprob)), 4)


def _transcribe_segments(model, audio, offset_ms=0, emit_type="partial", base_idx=0):
    """Roda o STT sobre `audio` (path WAV OU np.ndarray float32 16kHz mono) e EMITE
    um evento por Segment — usado pelas JANELAS AO VIVO (`partial`, efêmero).
    `offset_ms` desloca os timestamps p/ o eixo absoluto da reunião (as janelas
    recebem só um pedaço). `base_idx` numera os eventos a partir desse valor.
    Retorna (n_emitidos, duracao_ms_local).

    A passada FINAL e o batch NÃO usam esta função: eles coletam via
    `collect_segments` (sem emitir) p/ a diarização atribuir o speaker ANTES da
    emissão, garantindo que cada `segment` final saia uma única vez com o label.

    NÃO observa `_stop`: a transcrição é independente da captura — parar aqui no
    meio zeraria o transcript (bug histórico)."""
    segments, info = model.transcribe(
        audio,
        language="pt",
        vad_filter=True,
        condition_on_previous_text=False,
        beam_size=5,
    )
    n = 0
    for seg in segments:
        event = {
            "type": emit_type,
            "idx": base_idx + n,
            "start_ms": int(seg.start * 1000) + offset_ms,
            "end_ms": int(seg.end * 1000) + offset_ms,
            "speaker": None,  # speaker só nos `segment` finais, via diarização
            "text": seg.text.strip(),
        }
        # `partial` (efêmero) não carrega confidence no contrato; `segment` sim.
        if emit_type == "segment":
            event["confidence"] = _confidence(seg.avg_logprob)
        emit(event)
        n += 1
    duration_ms = int((getattr(info, "duration", 0.0) or 0.0) * 1000)
    return n, duration_ms


def collect_segments(model, audio):
    """Transcreve `audio` (path WAV OU np.ndarray 16kHz mono) e DEVOLVE
    (segments, duration_ms) SEM emitir — `segments` é uma lista de dicts
    {idx,start_ms,end_ms,text,confidence}. Usado pela passada FINAL da captura ao
    vivo e pelo modo batch (--audio-file): a emissão só acontece depois, em
    `diarize_and_emit`, já com o speaker_label da diarização — pra que cada
    `segment` final saia uma única vez no NDJSON."""
    segments_iter, info = model.transcribe(
        audio,
        language="pt",
        vad_filter=True,
        condition_on_previous_text=False,
        beam_size=5,
    )
    segments = []
    for seg in segments_iter:
        segments.append(
            {
                "idx": len(segments),
                "start_ms": int(seg.start * 1000),
                "end_ms": int(seg.end * 1000),
                "text": seg.text.strip(),
                "confidence": _confidence(seg.avg_logprob),
            }
        )
    duration_ms = int((getattr(info, "duration", 0.0) or 0.0) * 1000)
    return segments, duration_ms


# ---------------------------------------------------------------------------
# Diarização com sherpa-onnx (quem falou) — OPCIONAL, modelos ONNX locais livres
# ---------------------------------------------------------------------------

# Diretório dos modelos ONNX de diarização (baixados por
# scripts/setup-meeting-sidecar.sh). Override via env MEETING_SIDECAR_MODELS_DIR.
DEFAULT_MODELS_DIR = os.path.join(
    os.path.expanduser("~"), ".claude-manager", "meeting-sidecar", "models"
)
# Segmentation: pyannote-3.0 exportado p/ ONNX (livre, k2-fsa/sherpa-onnx).
SEG_MODEL_REL = os.path.join("sherpa-onnx-pyannote-segmentation-3-0", "model.onnx")
# Embedding de locutor: NeMo TitaNet small (livre).
EMB_MODEL_REL = "nemo_en_titanet_small.onnx"


class DiarizationUnavailable(Exception):
    """A diarização não pôde rodar (sherpa-onnx ausente ou modelos ONNX não
    baixados). Sinaliza degradação graciosa: emitimos um `error` de diarização e
    seguimos sem speaker — NÃO é fatal pra transcrição."""


def _models_dir():
    return os.environ.get("MEETING_SIDECAR_MODELS_DIR", DEFAULT_MODELS_DIR)


def _build_diarizer():
    """Constrói o OfflineSpeakerDiarization do sherpa-onnx (CPU, ONNX Runtime).
    Levanta DiarizationUnavailable com mensagem acionável se a lib faltar ou os
    modelos ONNX não estiverem em disco — NÃO usa torch nem token HF."""
    try:
        import sherpa_onnx
    except Exception as e:  # noqa: BLE001 — ImportError ou erro de import transitivo
        raise DiarizationUnavailable(
            f"sherpa-onnx indisponível ({e}) — rode scripts/setup-meeting-sidecar.sh"
        ) from e

    models_dir = _models_dir()
    seg_model = os.path.join(models_dir, SEG_MODEL_REL)
    emb_model = os.path.join(models_dir, EMB_MODEL_REL)
    missing = [p for p in (seg_model, emb_model) if not os.path.exists(p)]
    if missing:
        raise DiarizationUnavailable(
            "modelos de diarização ausentes ("
            + ", ".join(missing)
            + ") — rode scripts/setup-meeting-sidecar.sh para baixá-los"
        )

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=seg_model
            ),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=emb_model),
        # num_clusters=-1 + threshold: o nº de speakers é INFERIDO (não fixamos),
        # via clustering aglomerativo. threshold maior = menos splits (mais
        # conservador ao criar speakers novos).
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=0.5),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise DiarizationUnavailable(
            "config de diarização inválida (modelos corrompidos? rode o setup)"
        )
    return sherpa_onnx.OfflineSpeakerDiarization(config)


def _diarize(wav_path):
    """Roda a diarização sobre `wav_path`. Retorna uma lista de turnos
    [(start_s, end_s, label), …] ordenada por start. Levanta
    DiarizationUnavailable em qualquer falha de setup.

    O sherpa-onnx processa um array float32 mono — reamostramos o WAV pra a taxa
    esperada pelo diarizer (`sd.sample_rate`, tipicamente 16k). Os speakers vêm
    como inteiros (0,1,2…); convertemos pro mesmo formato SPEAKER_0N do resto do
    pipeline pra não mudar o contrato externo."""
    import numpy as np

    sd = _build_diarizer()
    emit({"type": "status", "state": "diarizing"})
    log(f"diarizando {wav_path}…")

    audio = _read_mono(wav_path, int(sd.sample_rate))
    if audio.size == 0:
        log("diarização: áudio vazio — sem turnos")
        return []

    try:
        result = sd.process(np.ascontiguousarray(audio, dtype=np.float32))
    except Exception as e:  # noqa: BLE001 — falha em runtime (áudio inválido, OOM)
        raise DiarizationUnavailable(f"falha ao diarizar: {e}") from e

    turns = [
        (float(seg.start), float(seg.end), f"SPEAKER_{int(seg.speaker):02d}")
        for seg in result.sort_by_start_time()
    ]
    turns.sort(key=lambda t: t[0])
    n_speakers = len({label for _s, _e, label in turns})
    log(f"diarização: {len(turns)} turnos, {n_speakers} speaker(s)")
    return turns


def _overlap_ms(a_start, a_end, b_start, b_end):
    """Sobreposição (em ms) de [a_start,a_end] com [b_start,b_end]; 0 se não há."""
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def assign_speakers(segments, turns):
    """Atribui um speaker_label a cada segment por MAIOR overlap temporal com os
    turnos da diarização. `turns` em segundos; `segments` com start_ms/end_ms.
    Muta os dicts de `segments` adicionando 'speaker' (label ou None) e devolve
    o conjunto ordenado de labels efetivamente usados. Segment sem nenhum overlap
    fica com speaker=None (silêncio/ruído entre turnos)."""
    used = set()
    for seg in segments:
        s_start, s_end = seg["start_ms"], seg["end_ms"]
        best_label = None
        best_overlap = 0
        for t_start_s, t_end_s, label in turns:
            ov = _overlap_ms(s_start, s_end, int(t_start_s * 1000), int(t_end_s * 1000))
            if ov > best_overlap:
                best_overlap = ov
                best_label = label
        seg["speaker"] = best_label
        if best_label is not None:
            used.add(best_label)
    return sorted(used)


def _voiced_intervals(wav_path, frame_s=0.05, energy_floor=1e-4):
    """Detecta regiões com voz numa trilha mono 16kHz por energia RMS em janelas
    de `frame_s`. Retorna [(start_s, end_s), …]. Heurística simples (sem VAD
    pesado): basta pra localizar QUANDO o mic teve voz, e cruzar com os turnos da
    diarização do mix pra achar o speaker 'você'."""
    import numpy as np

    audio = _read_mono_16k(wav_path)
    if audio.size == 0:
        return []
    frame = max(1, int(frame_s * TARGET_SR))
    n_frames = audio.size // frame
    if n_frames == 0:
        return []
    trimmed = audio[: n_frames * frame].reshape(n_frames, frame)
    rms = np.sqrt(np.mean(trimmed.astype(np.float32) ** 2, axis=1))
    # Limiar adaptativo: piso fixo OU metade do RMS mediano das janelas ativas,
    # o que for maior. Robusto a mic silencioso (tudo abaixo do piso → vazio).
    active = rms[rms > energy_floor]
    if active.size == 0:
        return []
    threshold = max(energy_floor, float(np.median(active)) * 0.5)
    voiced_mask = rms > threshold

    intervals = []
    start = None
    for i, on in enumerate(voiced_mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            intervals.append((start * frame_s, i * frame_s))
            start = None
    if start is not None:
        intervals.append((start * frame_s, n_frames * frame_s))
    return intervals


def detect_local_user_label(turns, mic_wav_path):
    """Descobre qual label da diarização é 'você' cruzando os turnos (diarizados
    sobre o MIX) com as regiões em que o MIC teve voz. A trilha do mic capta
    SOMENTE você (captura em 2 trilhas separadas), então o label com maior
    overlap acumulado contra a voz do mic é o usuário local.

    Retorna o label vencedor ou None (sem mic, sem voz no mic, ou empate zero)."""
    if not mic_wav_path or not os.path.exists(mic_wav_path):
        return None
    try:
        voiced = _voiced_intervals(mic_wav_path)
    except Exception as e:  # noqa: BLE001
        log(f"is_local_user: falha ao analisar o mic ({e}) — pulando")
        return None
    if not voiced:
        log("is_local_user: mic sem voz detectada — pulando")
        return None

    overlap_by_label = {}
    for t_start_s, t_end_s, label in turns:
        t_start_ms, t_end_ms = int(t_start_s * 1000), int(t_end_s * 1000)
        acc = 0
        for v_start_s, v_end_s in voiced:
            acc += _overlap_ms(
                t_start_ms, t_end_ms, int(v_start_s * 1000), int(v_end_s * 1000)
            )
        if acc > 0:
            overlap_by_label[label] = overlap_by_label.get(label, 0) + acc

    if not overlap_by_label:
        return None
    winner = max(overlap_by_label, key=overlap_by_label.get)
    log(
        f"is_local_user: speaker do mic = {winner} (overlap_ms={overlap_by_label[winner]})"
    )
    return winner


def emit_segments(segments):
    """Emite cada segment já com speaker (label ou None). Idempotência de idx:
    reindexamos sequencialmente na emissão."""
    for n, seg in enumerate(segments):
        emit(
            {
                "type": "segment",
                "idx": n,
                "start_ms": seg["start_ms"],
                "end_ms": seg["end_ms"],
                "speaker": seg.get("speaker"),
                "text": seg["text"],
                "confidence": seg.get("confidence"),
            }
        )


def diarize_and_emit(segments, mix_wav_path, mic_wav_path=None):
    """Pipeline de diarização pós-transcrição:
      1. diariza o MIX → turnos;
      2. casa cada segment ao turno de maior overlap (speaker_label);
      3. acha o label 'você' via overlap com a voz do MIC e emite os eventos
         `speaker` (is_local_user) ANTES dos segments;
      4. emite os segments já rotulados.

    Degrada com graça: se a diarização não estiver disponível (sherpa-onnx ou
    modelos ONNX ausentes), emite um `error` de diarização e os segments saem
    SEM speaker."""
    try:
        turns = _diarize(mix_wav_path)
    except DiarizationUnavailable as e:
        log(f"diarização indisponível — seguindo sem speaker: {e}")
        emit({"type": "error", "message": f"diarização indisponível: {e}"})
        emit_segments(segments)  # segments mantêm speaker=None
        return

    used_labels = assign_speakers(segments, turns)
    local_label = detect_local_user_label(turns, mic_wav_path)

    # Eventos `speaker` precedem os segments — o consumidor já conhece o
    # is_local_user de cada label ao receber o 1º segment que o referencia.
    for label in used_labels:
        emit(
            {
                "type": "speaker",
                "label": label,
                "is_local_user": label == local_label,
            }
        )

    emit_segments(segments)


# ---------------------------------------------------------------------------
# Orquestração
# ---------------------------------------------------------------------------


def run_audio_file(wav_path):
    if not os.path.exists(wav_path):
        emit({"type": "error", "message": f"arquivo não encontrado: {wav_path}"})
        return 1
    started = time.monotonic()
    try:
        model = load_model()
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "message": f"falha ao carregar STT: {e}"})
        return 1
    # BATCH puro: coleta os segments (sem emitir) e diariza sobre o próprio WAV.
    emit({"type": "status", "state": "transcribing"})
    segments, duration_ms = collect_segments(model, wav_path)
    log(f"transcrição (batch) concluída: {len(segments)} segments, {duration_ms}ms")
    # Modo offline: 1 trilha só, sem mic separado → diariza sobre o próprio WAV e
    # não há como inferir is_local_user (mic_wav_path=None).
    diarize_and_emit(segments, wav_path, mic_wav_path=None)
    if duration_ms <= 0:
        duration_ms = int((time.monotonic() - started) * 1000)
    emit({"type": "done", "segments": len(segments), "duration_ms": duration_ms})
    return 0


def _live_window_loop(model, paths):
    """Loop de transcrição AO VIVO por janelas: enquanto a captura roda (ou ainda
    há áudio novo após o stop), a cada WINDOW_SEC de áudio NOVO lê a janela a
    partir de `offset_samples` (o que já foi transcrito), transcreve e emite
    `partial`s com start_ms ABSOLUTO. Mantém o offset em SAMPLES p/ alinhar o eixo.

    Crítico: NÃO faz `if _stop.is_set(): break`. O `_stop` para a CAPTURA; aqui
    apenas deixamos de esperar novas janelas QUANDO o stop chegou E não há mais
    áudio novo pra processar — então drenamos o resto antes de sair."""
    offset_samples = 0
    while True:
        stopped = _stop.is_set()
        # Espera acumular uma janela cheia enquanto captura; após o stop, drena
        # qualquer resto (mesmo < WINDOW_SEC) e então encerra o loop.
        if not stopped:
            _stop.wait(timeout=WINDOW_SEC)

        mix = _read_mix_16k(paths)
        new = mix[offset_samples:]
        new_sec = new.size / float(TARGET_SR)

        offset_ms = int(offset_samples / TARGET_SR * 1000)
        # base_idx ESTÁVEL e único por janela: deriva do offset (em centésimos de
        # segundo), então os `partial`s de janelas distintas nunca colidem de idx
        # e a UI os mantém lado a lado em vez de sobrescrever.
        base_idx = int(offset_samples / TARGET_SR * 100)

        if stopped:
            # Pós-stop: processa o resto (se relevante) e sai do loop.
            if new.size > 0 and new_sec >= 0.3:
                _transcribe_segments(
                    model,
                    new,
                    offset_ms=offset_ms,
                    emit_type="partial",
                    base_idx=base_idx,
                )
            return
        if new_sec < MIN_WINDOW_SEC:
            continue  # ainda não há janela suficiente — aguarda mais

        try:
            _transcribe_segments(
                model, new, offset_ms=offset_ms, emit_type="partial", base_idx=base_idx
            )
        except Exception as e:  # noqa: BLE001
            # Falha numa janela ao vivo não derruba a captura — a passada final
            # reconcilia tudo. Loga e segue.
            log(f"janela ao vivo falhou ({e}) — segue; a final reconcilia")
        offset_samples = mix.size


def run_capture(out_dir):
    started = time.monotonic()
    # TemporaryDirectory(dir=out_dir) usa mkdtemp, que NÃO cria o parent.
    # <userData>/meetings precisa existir antes, senão é FileNotFoundError em
    # toda captura real (o modo --audio-file não passa --out-dir, por isso passava).
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="meeting-cap-", dir=out_dir or None) as tmp:
        # Modelo carregado ANTES de iniciar as trilhas (e reusado por todas as
        # janelas + a final). Se falhar, aborta sem segurar o device.
        try:
            model = load_model()
        except Exception as e:  # noqa: BLE001
            emit({"type": "error", "message": f"falha ao carregar STT: {e}"})
            return 1

        try:
            tracks, paths = start_capture_tracks(tmp)
        except RuntimeError as e:
            emit({"type": "error", "message": str(e)})
            return 1

        # A trilha do mic identifica "você" — guardamos pra inferir is_local_user
        # na diarização do fechamento.
        mic_path = next((p for _proc, p, kind in tracks if kind == "mic"), None)

        # Loop ao vivo roda na thread principal; a captura (pw-record) é process
        # externo. O loop só retorna após o _stop ter sido sinalizado e o resto
        # drenado. try/finally garante que os pw-record morrem em qualquer saída.
        try:
            _live_window_loop(model, paths)
        finally:
            log("stop sinalizado — encerrando as gravações")
            stop_capture_tracks(tracks)

        # Coleta as trilhas que produziram áudio (> header WAV) p/ a passada final.
        final_paths = [
            p for p in paths if os.path.exists(p) and os.path.getsize(p) > 44
        ]
        if not final_paths:
            emit({"type": "error", "message": "captura encerrou sem produzir áudio"})
            return 1

        mix_path = os.path.join(tmp, "mix.wav")
        try:
            mix_tracks_to_wav(final_paths, mix_path)
        except Exception as e:  # noqa: BLE001
            emit({"type": "error", "message": f"falha no mix de áudio: {e}"})
            return 1

        # Passada FINAL sobre o mix completo: COLETA os segments (sem emitir) p/
        # que a diarização atribua o speaker antes da emissão. Os `segment` finais
        # persistem e reconciliam os `partial`s provisórios das janelas ao vivo
        # (a UI reconcilia por start_ms).
        emit({"type": "status", "state": "transcribing"})
        segments, duration_ms = collect_segments(model, mix_path)
        log(f"transcrição final concluída: {len(segments)} segments, {duration_ms}ms")
        # Diariza DENTRO do `with`: os WAVs (mix + mic) ainda existem aqui; o
        # TemporaryDirectory só some na saída do bloco. Emite os `speaker`
        # (is_local_user) ANTES dos `segment` finais.
        diarize_and_emit(segments, mix_path, mic_wav_path=mic_path)

    if duration_ms <= 0:
        duration_ms = int((time.monotonic() - started) * 1000)
    emit({"type": "done", "segments": len(segments), "duration_ms": duration_ms})
    return 0


def main():
    parser = argparse.ArgumentParser(description="Sidecar real (captura + STT)")
    parser.add_argument("--meeting-id", required=True)
    parser.add_argument(
        "--audio-file",
        default=None,
        help="MODO TESTE: transcreve este WAV em vez de capturar áudio ao vivo.",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Diretório para artefatos temporários de captura (default: temp do SO).",
    )
    args = parser.parse_args()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    watcher = threading.Thread(target=_watch_stdin_closed, daemon=True)
    watcher.start()

    log(f"iniciando para meeting {args.meeting_id}")

    try:
        if args.audio_file:
            log(f"modo --audio-file: {args.audio_file}")
            return run_audio_file(args.audio_file)
        return run_capture(args.out_dir)
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "message": f"erro inesperado no sidecar: {e}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
