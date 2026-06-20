#!/usr/bin/env python3
"""Testes stdlib-only do casamento segment↔speaker e do is_local_user.

Roda com o Python do SISTEMA (sem numpy/torch/pyannote): os imports pesados do
sidecar.py são todos lazy (dentro das funções de STT/diarização), então importar
o módulo e exercitar a lógica PURA de overlap não puxa nenhuma dep de ML.

Uso:  python3 sidecar/test_diarization.py
(Não entra no vitest do app — é a contraparte Python da lógica que vive em
Python; o lado TS testa o despacho do evento `speaker` → store no vitest.)
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidecar  # noqa: E402


class TestOverlap(unittest.TestCase):
    def test_overlap_ms_basic(self):
        self.assertEqual(sidecar._overlap_ms(0, 1000, 500, 1500), 500)
        self.assertEqual(sidecar._overlap_ms(0, 1000, 1000, 2000), 0)  # adjacente
        self.assertEqual(sidecar._overlap_ms(0, 1000, 2000, 3000), 0)  # disjunto
        self.assertEqual(sidecar._overlap_ms(0, 1000, -500, 500), 500)  # parcial à esq


class TestAssignSpeakers(unittest.TestCase):
    def test_assigns_by_max_overlap(self):
        # 2 turnos: SPEAKER_00 [0,2s], SPEAKER_01 [2s,4s].
        turns = [(0.0, 2.0, "SPEAKER_00"), (2.0, 4.0, "SPEAKER_01")]
        segments = [
            {"idx": 0, "start_ms": 0, "end_ms": 1500, "text": "a"},  # → 00
            {"idx": 1, "start_ms": 2100, "end_ms": 3900, "text": "b"},  # → 01
            # cruza a fronteira mas pende mais p/ 01 (1400ms vs 600ms).
            {"idx": 2, "start_ms": 1400, "end_ms": 3400, "text": "c"},
        ]
        used = sidecar.assign_speakers(segments, turns)
        self.assertEqual(
            [s["speaker"] for s in segments], ["SPEAKER_00", "SPEAKER_01", "SPEAKER_01"]
        )
        self.assertEqual(used, ["SPEAKER_00", "SPEAKER_01"])

    def test_segment_without_overlap_is_none(self):
        turns = [(0.0, 1.0, "SPEAKER_00")]
        segments = [{"idx": 0, "start_ms": 5000, "end_ms": 6000, "text": "silêncio"}]
        used = sidecar.assign_speakers(segments, turns)
        self.assertIsNone(segments[0]["speaker"])
        self.assertEqual(used, [])

    def test_no_turns_leaves_all_none(self):
        segments = [{"idx": 0, "start_ms": 0, "end_ms": 1000, "text": "x"}]
        used = sidecar.assign_speakers(segments, [])
        self.assertIsNone(segments[0]["speaker"])
        self.assertEqual(used, [])


class TestDetectLocalUser(unittest.TestCase):
    """is_local_user: o label com maior overlap contra a voz do MIC. Stubamos
    _voiced_intervals (que usa numpy/soundfile) p/ não puxar deps de áudio."""

    def setUp(self):
        self._orig = sidecar._voiced_intervals
        self._orig_exists = os.path.exists

    def tearDown(self):
        sidecar._voiced_intervals = self._orig
        os.path.exists = self._orig_exists

    def test_picks_speaker_overlapping_mic_voice(self):
        # Mic teve voz em [0,2s] → casa com SPEAKER_00; SPEAKER_01 fala depois.
        sidecar._voiced_intervals = lambda _p: [(0.0, 2.0)]
        os.path.exists = lambda _p: True
        turns = [(0.0, 2.0, "SPEAKER_00"), (2.5, 4.0, "SPEAKER_01")]
        self.assertEqual(
            sidecar.detect_local_user_label(turns, "mic.wav"), "SPEAKER_00"
        )

    def test_other_speaker_wins_when_mic_overlaps_them(self):
        sidecar._voiced_intervals = lambda _p: [(2.5, 4.0)]
        os.path.exists = lambda _p: True
        turns = [(0.0, 2.0, "SPEAKER_00"), (2.5, 4.0, "SPEAKER_01")]
        self.assertEqual(
            sidecar.detect_local_user_label(turns, "mic.wav"), "SPEAKER_01"
        )

    def test_no_mic_path_returns_none(self):
        self.assertIsNone(sidecar.detect_local_user_label([(0.0, 1.0, "S0")], None))

    def test_silent_mic_returns_none(self):
        sidecar._voiced_intervals = lambda _p: []
        os.path.exists = lambda _p: True
        self.assertIsNone(
            sidecar.detect_local_user_label([(0.0, 1.0, "S0")], "mic.wav")
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
