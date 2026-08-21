"""Qwen3-ASR + Qwen3-ForcedAligner model lifecycle and transcription pipeline.

Two separate models are used, matching how Qwen ships them:
  - Qwen3ASRModel produces plain text per audio chunk (no built-in timing).
  - Qwen3ForcedAligner takes that text back against the same audio and
    produces word/character-level timestamps.

Both run CPU-only (no CUDA runtime is present in this image) with bfloat16
weights - verified working on this architecture, and it roughly halves the
memory each model needs versus float32 with no observed correctness issues.

The two models are also never resident together: whichever phase is running
(transcription vs. alignment) loads only the model it needs and releases the
other first. Loading either model from a warm local cache takes ~1-2s, far
cheaper than paying for both models' memory at once. Silero VAD stays loaded
throughout since it's tiny; it splits long, continuous vocal sections into
bounded chunks before either model sees them, which avoids the skipped/
repeated-phrase failure mode long-form ASR models are prone to, and keeps
every aligner call safely under its documented 5-minute-per-call limit.
"""

import gc
import os
import threading
import time
from types import SimpleNamespace

import soundfile as sf
import torch
from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner
from silero_vad import get_speech_timestamps, load_silero_vad

from subtitle_format import preserve_unaligned_text, read_srt_segments, write_rolling_srt
from vad_chunks import lossless_speech_chunks

DTYPE = torch.bfloat16

# A 15s chunk at typical lyric density comes nowhere close to this; raise it
# if very dense/rapid lyrics ever get truncated mid-chunk.
MAX_NEW_TOKENS = 256

# Defensive ceiling below Qwen3-ForcedAligner's documented 5-minute limit.
# Only reachable via an unusually long creator-caption cue; VAD-derived ASR
# chunks are already bounded by vadChunkSeconds (validated to <= 30s).
MAX_ALIGN_SECONDS = 290

# Both Qwen models take/return full language names ("Chinese", "English"), not
# ISO codes - confirmed by an actual transcription (it returned "English", not
# "en"). Everything else in this pipeline (config, subtitle_format.py's CJK
# checks, the songs.language DB column) speaks ISO 639-1 codes, so this table
# is the one place that translates between the two conventions.
QWEN_LANGUAGE_NAMES = {
    "zh": "Chinese", "en": "English", "yue": "Cantonese", "ar": "Arabic",
    "de": "German", "fr": "French", "es": "Spanish", "pt": "Portuguese",
    "id": "Indonesian", "it": "Italian", "ko": "Korean", "ru": "Russian",
    "th": "Thai", "vi": "Vietnamese", "ja": "Japanese", "tr": "Turkish",
    "hi": "Hindi", "ms": "Malay", "nl": "Dutch", "sv": "Swedish",
    "da": "Danish", "fi": "Finnish", "pl": "Polish", "cs": "Czech",
    "fil": "Filipino", "fa": "Persian", "el": "Greek", "hu": "Hungarian",
    "mk": "Macedonian", "ro": "Romanian",
}
_ISO_CODES_BY_QWEN_NAME = {name.lower(): code for code, name in QWEN_LANGUAGE_NAMES.items()}


def to_qwen_language(iso_code):
    """Translate our internal ISO code to what Qwen expects. None means auto-detect."""
    if not iso_code:
        return None
    return QWEN_LANGUAGE_NAMES.get(iso_code, iso_code)


def from_qwen_language(name):
    """Translate Qwen's returned language name back to an internal ISO code."""
    if not name:
        return None
    return _ISO_CODES_BY_QWEN_NAME.get(name.lower(), name.lower())


class QwenTranscriber:
    def __init__(self, model_root):
        self.model_root = model_root
        self.model = None
        self.aligner = None
        self.vad_model = None

    def mount(self, settings):
        # Pre-warms the model most jobs need first. The aligner loads lazily
        # in _use_aligner() when a job actually reaches its alignment phase,
        # so an explicit "mount" never holds both models in memory at once.
        if self.vad_model is None:
            self.vad_model = load_silero_vad()
        self._use_asr(settings)

    def transcribe(
        self,
        audio_path,
        output_dir,
        settings,
        emit,
        caption_path=None,
        caption_language=None,
    ):
        if self.vad_model is None:
            self.vad_model = load_silero_vad()

        def transcription_progress(percent):
            emit("progress", progress=round(percent * 0.5, 2))

        def alignment_progress(percent):
            emit("progress", progress=round(50 + percent * 0.5, 2))

        audio, sample_rate = sf.read(audio_path, dtype="float32", always_2d=False)
        if getattr(audio, "ndim", 1) > 1:
            audio = audio.mean(axis=1)

        if caption_path:
            emit("stage", stage="Loading creator-provided captions")
            raw_segments = read_srt_segments(caption_path)
        else:
            raw_segments = []

        vad_seconds = None
        transcribe_seconds = None
        if raw_segments:
            language = caption_language or "en"
            emit("progress", progress=50)
        else:
            if caption_path:
                emit("stage", stage="Creator captions contain no lyrics; using Qwen3-ASR")
            else:
                emit("stage", stage="Detecting vocals and language")
            raw_segments, language, vad_seconds, transcribe_seconds = self._transcribe_chunks(
                audio, sample_rate, settings, transcription_progress,
            )

        emit("stage", stage="Aligning lyric timings")
        align_start = time.time()
        aligned_segments = self._align_segments(
            raw_segments, audio, sample_rate, language, settings, alignment_progress,
        )
        align_seconds = time.time() - align_start
        result = {
            "segments": preserve_unaligned_text(raw_segments, aligned_segments),
            "language": language,
        }
        srt_path = os.path.join(output_dir, f"{os.path.splitext(os.path.basename(audio_path))[0]}.srt")
        max_line_width = settings["maxLineWidth"]
        min_line_width = settings.get("minLineWidth", 12)
        if language in {"zh", "yue"}:
            max_line_width = max(1, max_line_width // 2)
            min_line_width = max(1, min_line_width // 2)
        write_rolling_srt(result, srt_path, max_line_width, min_line_width)
        return {
            "language": language,
            "srt": srt_path,
            "timings": {"vad": vad_seconds, "transcribe": transcribe_seconds, "align": align_seconds},
        }

    def _use_asr(self, settings):
        """Load the ASR model, releasing the aligner first if it was resident."""
        if self.aligner is not None:
            self.aligner = None
            gc.collect()
        if self.model is None:
            self.model = Qwen3ASRModel.from_pretrained(
                settings["model"],
                dtype=DTYPE,
                device_map="cpu",
                max_inference_batch_size=max(1, int(settings.get("batchSize", 2))),
                max_new_tokens=MAX_NEW_TOKENS,
            )
        return self.model

    def _use_aligner(self, settings):
        """Load the forced aligner, releasing the ASR model first if resident."""
        if self.model is not None:
            self.model = None
            gc.collect()
        if self.aligner is None:
            self.aligner = Qwen3ForcedAligner.from_pretrained(
                settings["alignerModel"],
                dtype=DTYPE,
                device_map="cpu",
            )
        return self.aligner

    def _transcribe_chunks(self, audio, sample_rate, settings, progress_cb):
        vad_start = time.time()
        vad_segments = self._speech_regions(audio, sample_rate, settings)
        chunks = lossless_speech_chunks(vad_segments, settings["vadChunkSeconds"])
        vad_seconds = time.time() - vad_start
        forced_language = settings.get("language")
        if not chunks:
            return [], forced_language or "en", vad_seconds, 0.0

        transcribe_start = time.time()
        model = self._use_asr(settings)
        batch_size = max(1, int(settings.get("batchSize", 2)))
        qwen_forced_language = to_qwen_language(forced_language)
        raw_segments = []
        language_votes = {}
        total_chunks = len(chunks)
        completed_chunks = 0
        # A single batched model.generate() call gives no per-item signal while
        # it runs, so a larger batchSize otherwise leaves the bar frozen for an
        # entire batch. Run each batch in a thread and ease progress toward its
        # estimated finish time in the meantime; the estimate self-corrects
        # from the previous batch's actual duration.
        seconds_per_chunk_estimate = 6.0
        for batch_start in range(0, total_chunks, batch_size):
            batch = chunks[batch_start:batch_start + batch_size]
            audio_inputs = [
                (audio[int(chunk["start"] * sample_rate):int(chunk["end"] * sample_rate)], sample_rate)
                for chunk in batch
            ]
            results = self._run_batch_with_heartbeat(
                model, audio_inputs, qwen_forced_language, len(batch),
                completed_chunks, total_chunks, seconds_per_chunk_estimate, progress_cb,
            )
            batch_seconds = time.time() - results.pop("_started_at")
            seconds_per_chunk_estimate = batch_seconds / max(1, len(batch))
            for chunk, result in zip(batch, results["results"]):
                text = (result.text or "").strip()
                if not text:
                    continue
                raw_segments.append({"start": chunk["start"], "end": chunk["end"], "text": text})
                detected = forced_language or from_qwen_language(getattr(result, "language", None))
                if detected:
                    language_votes[detected] = language_votes.get(detected, 0) + 1
            completed_chunks += len(batch)
            progress_cb(min(99, round(100 * completed_chunks / total_chunks)))
        transcribe_seconds = time.time() - transcribe_start

        language = forced_language or (max(language_votes, key=language_votes.get) if language_votes else "en")
        return raw_segments, language, vad_seconds, transcribe_seconds

    def _run_batch_with_heartbeat(
        self, model, audio_inputs, qwen_language, batch_len,
        completed_chunks, total_chunks, seconds_per_chunk_estimate, progress_cb,
    ):
        """Run one batched model.transcribe() call in a thread, easing progress
        toward its estimated finish time while it runs. model.generate() gives
        no mid-call signal, so without this the bar sits frozen for the whole
        batch - worse the larger batchSize is.
        """
        outcome = {}

        def run():
            try:
                outcome["results"] = model.transcribe(
                    audio=audio_inputs,
                    language=[qwen_language] * batch_len,
                )
            except Exception as error:  # noqa: BLE001 - re-raised on the main thread below
                outcome["error"] = error

        started_at = time.time()
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        estimated_seconds = seconds_per_chunk_estimate * batch_len
        while thread.is_alive():
            thread.join(timeout=1.0)
            if not thread.is_alive():
                break
            elapsed = time.time() - started_at
            # Hyperbolic ease: approaches but never reaches 1.0, and keeps
            # creeping however wrong the initial per-chunk estimate turns out
            # to be (e.g. a much larger batchSize than previously measured),
            # rather than freezing dead at a hard percentage ceiling.
            batch_fraction = elapsed / (elapsed + estimated_seconds) if estimated_seconds > 0 else 0
            estimated_completed = completed_chunks + batch_fraction * batch_len
            progress_cb(min(99, round(100 * estimated_completed / total_chunks)))
        if "error" in outcome:
            raise outcome["error"]
        outcome["_started_at"] = started_at
        return outcome

    def _speech_regions(self, audio, sample_rate, settings):
        vad_onset = settings["vadOnset"]
        vad_offset = settings.get("vadOffset", max(0.01, vad_onset - 0.15))
        timestamps = get_speech_timestamps(
            torch.from_numpy(audio),
            self.vad_model,
            sampling_rate=sample_rate,
            threshold=vad_onset,
            neg_threshold=vad_offset,
        )
        return [
            SimpleNamespace(start=stamp["start"] / sample_rate, end=stamp["end"] / sample_rate)
            for stamp in timestamps
        ]

    def _align_segments(self, raw_segments, audio, sample_rate, language, settings, progress_cb):
        if not raw_segments:
            return []
        aligner = self._use_aligner(settings)
        qwen_language = to_qwen_language(language) or "English"
        aligned = []
        total = len(raw_segments)
        for index, segment in enumerate(raw_segments):
            start_sample = max(0, int(segment["start"] * sample_rate))
            end_sample = min(len(audio), int(segment["end"] * sample_rate))
            duration = (end_sample - start_sample) / sample_rate
            units = []
            if end_sample > start_sample and segment["text"].strip() and duration <= MAX_ALIGN_SECONDS:
                results = aligner.align(
                    audio=(audio[start_sample:end_sample], sample_rate),
                    text=segment["text"],
                    language=qwen_language,
                )
                units = results[0].items if results else []
            words = [{
                "word": unit.text,
                "start": segment["start"] + unit.start_time,
                "end": segment["start"] + unit.end_time,
            } for unit in units]
            aligned.append({
                "start": segment["start"],
                "end": segment["end"],
                "text": segment["text"],
                "words": words,
            })
            progress_cb(round(100 * (index + 1) / total))
        return aligned

    def unmount(self):
        self.model = None
        self.aligner = None
        self.vad_model = None
        gc.collect()
