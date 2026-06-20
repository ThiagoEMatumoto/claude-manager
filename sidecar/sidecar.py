#!/usr/bin/env python3
"""Sidecar REAL da Meeting Intelligence: captura de áudio (PipeWire) + STT pt-BR
(faster-whisper) emitindo o MESMO protocolo NDJSON do fake_sidecar.py.

Diferenças vs o fake:
  - Captura áudio do sistema (monitor do sink default = vozes dos outros) + mic
    (você) via `pw-record` + `wpctl`/`pw-cli` — SEM ffmpeg/pactl/parec.
  - Transcreve com faster-whisper large-v3, language='pt', VAD, em GPU (CUDA)
    com fallback automático para CPU se o CUDA estiver indisponível/incompatível.
  - SEM diarização (é outra task): emite speaker=None nos segments.

Contrato NDJSON (stdout, 1 evento por linha, flush=True) — idêntico ao fake:
  {"type":"status","state":"capturing"|"transcribing"|...}
  {"type":"segment","idx":N,"start_ms":..,"end_ms":..,"speaker":null,
   "text":"...","confidence":<float|null>}
  {"type":"done","segments":N,"duration_ms":...}
  {"type":"error","message":"..."}

stderr = só log legível (device, VRAM, progresso). stdout = SÓ NDJSON.
SIGINT/SIGTERM = stop graceful (para a captura, transcreve o que já gravou,
emite `done`). Orphan-guard: stdin fecha (main morreu) → auto-encerra, liberando
o device de áudio.

Modos:
  --audio-file <wav>  MODO TESTE/OFFLINE: pula a captura e transcreve um WAV
                      existente, emitindo todos os segments + done. OBRIGATÓRIO
                      para validação sem hardware/áudio ao vivo.
  (sem --audio-file)  Captura 2 trilhas (monitor + mic) com pw-record, mixa em
                      numpy, e transcreve em batch ao fim da captura.

Decisão de design (ao-vivo vs batch): a captura grava as 2 trilhas em arquivos
temporários durante a reunião; a transcrição roda em BATCH no fechamento (sobre o
mix completo). faster-whisper já segmenta por VAD e cada `Segment` vira um evento
`segment` — então mesmo no modo batch a UI recebe todos os segments granulares.
O streaming ao-vivo por janelas deslizantes (emitir segments DURANTE a captura)
fica como follow-up: o risco de gerenciar buffers/janelas em paralelo com a
captura (e o custo de carregar o WhisperModel co-residente com a gravação) não
compensa nesta fatia. `--audio-file` exercita exatamente o mesmo caminho de STT.
"""

import argparse
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
        # stdin=DEVNULL: pw-record não lê stdin; stdout/stderr → PIPE só p/ não
        # poluir o NDJSON do nosso stdout.
        return subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
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


def capture_two_tracks(out_dir):
    """Grava monitor + mic em 2 WAVs temporários até `_stop` ser sinalizado.
    Retorna a lista de caminhos efetivamente gravados (pode ser 1 se só um
    device existir). Levanta RuntimeError se NENHUM device gravar."""
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
            "nenhum device de áudio capturável (verifique pw-record e os devices "
            "default do PipeWire via `wpctl status`)"
        )

    # Detecta falha imediata de um pw-record (ex.: target inválido) sem abortar a
    # captura inteira se a OUTRA trilha estiver de pé.
    time.sleep(0.4)
    alive = []
    for proc, path, kind in tracks:
        if proc.poll() is not None:
            err = (proc.stderr.read() or b"").decode("utf-8", "replace").strip()
            log(f"trilha {kind} morreu ao iniciar (rc={proc.returncode}): {err}")
        else:
            alive.append((proc, path, kind))

    if not alive:
        raise RuntimeError(
            "todas as trilhas de captura falharam ao iniciar (target inválido?)"
        )

    log(f"capturando {len(alive)} trilha(s); aguardando stop…")
    emit({"type": "status", "state": "capturing"})

    # Bloqueia até stop. _stop é setado por SIGINT/SIGTERM ou stdin fechado.
    _stop.wait()
    log("stop sinalizado — encerrando as gravações")

    paths = []
    for proc, path, _kind in alive:
        _stop_proc(proc)
        if os.path.exists(path) and os.path.getsize(path) > 44:  # > header WAV
            paths.append(path)
    if not paths:
        raise RuntimeError("captura encerrou sem produzir áudio")
    return paths


# ---------------------------------------------------------------------------
# Mix em numpy + soundfile (SEM ffmpeg)
# ---------------------------------------------------------------------------


def _read_mono_16k(path):
    """Lê um WAV via soundfile, downmixa pra mono e reamostra pra 16kHz com
    interpolação linear (numpy puro, sem scipy/ffmpeg). Retorna float32 [-1,1]."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)  # downmix
    if sr != TARGET_SR and mono.size > 0:
        # Reamostragem linear: suficiente p/ STT (whisper é robusto). Evita scipy.
        duration = mono.size / float(sr)
        n_out = max(1, int(round(duration * TARGET_SR)))
        x_old = np.linspace(0.0, duration, num=mono.size, endpoint=False)
        x_new = np.linspace(0.0, duration, num=n_out, endpoint=False)
        mono = np.interp(x_new, x_old, mono).astype(np.float32)
    return mono


def mix_tracks_to_wav(paths, out_path):
    """Lê N trilhas, alinha pelo comprimento (zero-pad), soma e normaliza pra
    evitar clipping. Escreve um WAV 16kHz mono. Retorna out_path."""
    import numpy as np
    import soundfile as sf

    tracks = [_read_mono_16k(p) for p in paths]
    tracks = [t for t in tracks if t.size > 0]
    if not tracks:
        raise RuntimeError("trilhas vazias após decodificação")

    length = max(t.size for t in tracks)
    acc = np.zeros(length, dtype=np.float32)
    for t in tracks:
        if t.size < length:
            t = np.pad(t, (0, length - t.size))
        acc += t

    peak = float(np.max(np.abs(acc))) if acc.size else 0.0
    if peak > 1.0:
        acc = acc / peak  # normaliza só se estourou

    sf.write(out_path, acc, TARGET_SR, subtype="PCM_16")
    log(f"mix escrito: {out_path} ({length / TARGET_SR:.1f}s, {len(tracks)} trilhas)")
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


def transcribe(wav_path):
    """Transcreve `wav_path` com faster-whisper large-v3 (pt, VAD). Emite um
    evento `segment` por Segment retornado e devolve (n_segments, duration_ms).

    Robustez Blackwell: se a inicialização do modelo na GPU explodir (ex.: kernel
    incompatível em runtime, não pego pelo cuda.is_available), reinicia na CPU."""
    from faster_whisper import WhisperModel

    device, compute_type = _pick_device()

    def _load(dev, ct):
        log(f"carregando WhisperModel large-v3 (device={dev}, compute={ct})")
        return WhisperModel("large-v3", device=dev, compute_type=ct)

    try:
        model = _load(device, compute_type)
    except Exception as e:  # noqa: BLE001
        if device != "cpu":
            log(f"falha ao carregar na GPU ({e}) — fallback CPU")
            device, compute_type = "cpu", "int8"
            model = _load(device, compute_type)
        else:
            raise

    emit({"type": "status", "state": "transcribing"})

    segments, info = model.transcribe(
        wav_path,
        language="pt",
        vad_filter=True,
        condition_on_previous_text=False,
        beam_size=5,
    )

    duration_ms = int((getattr(info, "duration", 0.0) or 0.0) * 1000)
    n = 0
    for seg in segments:
        if _stop.is_set():
            # Stop durante a transcrição: encerra o que já saiu (graceful).
            log("stop durante transcrição — interrompendo o stream de segments")
            break
        confidence = None
        if seg.avg_logprob is not None:
            # avg_logprob (log-prob) → ~[0,1] só pra UI; não é probabilidade real.
            import math

            confidence = round(float(math.exp(seg.avg_logprob)), 4)
        emit(
            {
                "type": "segment",
                "idx": n,
                "start_ms": int(seg.start * 1000),
                "end_ms": int(seg.end * 1000),
                "speaker": None,  # diarização é outra task
                "text": seg.text.strip(),
                "confidence": confidence,
            }
        )
        n += 1

    log(f"transcrição concluída: {n} segments, {duration_ms}ms (device={device})")
    return n, duration_ms


# ---------------------------------------------------------------------------
# Orquestração
# ---------------------------------------------------------------------------


def run_audio_file(wav_path):
    if not os.path.exists(wav_path):
        emit({"type": "error", "message": f"arquivo não encontrado: {wav_path}"})
        return 1
    started = time.monotonic()
    n, duration_ms = transcribe(wav_path)
    if duration_ms <= 0:
        duration_ms = int((time.monotonic() - started) * 1000)
    emit({"type": "done", "segments": n, "duration_ms": duration_ms})
    return 0


def run_capture(out_dir):
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="meeting-cap-", dir=out_dir or None) as tmp:
        try:
            paths = capture_two_tracks(tmp)
        except RuntimeError as e:
            emit({"type": "error", "message": str(e)})
            return 1

        mix_path = os.path.join(tmp, "mix.wav")
        try:
            mix_tracks_to_wav(paths, mix_path)
        except Exception as e:  # noqa: BLE001
            emit({"type": "error", "message": f"falha no mix de áudio: {e}"})
            return 1

        n, duration_ms = transcribe(mix_path)

    if duration_ms <= 0:
        duration_ms = int((time.monotonic() - started) * 1000)
    emit({"type": "done", "segments": n, "duration_ms": duration_ms})
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
