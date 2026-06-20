#!/usr/bin/env python3
"""Sidecar FAKE da Meeting Intelligence.

Sem ML, áudio ou dependências externas — só stdlib. Existe para validar o
encanamento do processo (spawn → NDJSON no stdout → transcript ao vivo na UI →
kill limpo → reconciliação) ANTES de instalar faster-whisper/pyannote/pw-record.

Contrato NDJSON (uma linha JSON por evento no stdout, `flush=True`):
  {"type":"status","state":"capturing"}
  {"type":"segment","idx":N,"start_ms":..,"end_ms":..,"speaker":"SPEAKER_0X",
   "text":"...","confidence":0.9}
  {"type":"done","segments":N,"duration_ms":...}

stderr é só log legível. SIGINT (stop graceful do main) → emite `done` parcial e
sai 0. Orphan-guard: se o stdin fechar (main morreu), auto-encerra para não
segurar o device de áudio no sidecar real.
"""

import argparse
import json
import signal
import sys
import threading
import time

SEGMENT_INTERVAL_S = 0.8

FAKE_TRANSCRIPT = [
    ("SPEAKER_00", "Bom dia pessoal, vamos começar a reunião de planejamento."),
    (
        "SPEAKER_01",
        "Perfeito. Acho que o primeiro ponto é revisar o roadmap do trimestre.",
    ),
    (
        "SPEAKER_00",
        "Concordo. O João ficou de mandar os números de conversão até sexta.",
    ),
    ("SPEAKER_01", "Sim, já tenho o draft. Falta só validar com o time de dados."),
    ("SPEAKER_00", "Ótimo. E sobre a integração com o Calendar, como está?"),
    ("SPEAKER_02", "Está quase pronta, devo abrir a PR ainda hoje."),
    ("SPEAKER_00", "Show. Então fechamos os action items e seguimos."),
    ("SPEAKER_01", "Combinado, obrigado pessoal."),
]

# Sinaliza encerramento gracioso (SIGINT) para o loop principal parar entre
# segmentos e emitir um `done` parcial em vez de morrer no meio de um print.
_stop = threading.Event()


def emit(event):
    sys.stdout.write(json.dumps(event, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write(f"[fake_sidecar] {msg}\n")
    sys.stderr.flush()


def _on_sigint(_signum, _frame):
    log("SIGINT recebido — encerrando graciosamente")
    _stop.set()


def _watch_stdin_closed():
    """Orphan-guard: o main mantém o stdin (pipe) aberto. Quando ele morre, o
    pipe fecha e read() retorna EOF — então o sidecar se auto-encerra. No sidecar
    real isso libera o device de áudio mesmo sem o main ter mandado SIGINT."""
    try:
        while sys.stdin.readline():
            pass
    except (ValueError, OSError):
        pass
    if not _stop.is_set():
        log("stdin fechado (parent morreu) — auto-encerrando")
        _stop.set()


def main():
    parser = argparse.ArgumentParser(description="Fake sidecar (NDJSON over stdout)")
    parser.add_argument("--meeting-id", required=True)
    args = parser.parse_args()

    signal.signal(signal.SIGINT, _on_sigint)
    signal.signal(signal.SIGTERM, _on_sigint)

    watcher = threading.Thread(target=_watch_stdin_closed, daemon=True)
    watcher.start()

    log(f"iniciando captura fake para meeting {args.meeting_id}")
    started = time.monotonic()
    emit({"type": "status", "state": "capturing"})

    emitted = 0
    cursor_ms = 0
    for speaker, text in FAKE_TRANSCRIPT:
        if _stop.wait(SEGMENT_INTERVAL_S):
            break
        start_ms = cursor_ms
        end_ms = cursor_ms + 2500
        cursor_ms = end_ms
        emit(
            {
                "type": "segment",
                "idx": emitted,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "speaker": speaker,
                "text": text,
                "confidence": 0.9,
            }
        )
        emitted += 1

    duration_ms = int((time.monotonic() - started) * 1000)
    emit({"type": "done", "segments": emitted, "duration_ms": duration_ms})
    log(f"finalizado: {emitted} segmentos, {duration_ms}ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
