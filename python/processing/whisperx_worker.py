#!/usr/bin/env python3
"""Long-lived JSON-lines WhisperX worker for CPU lyric scripting."""

import gc
import json
import os
import sys
import traceback

import torch
import whisperx
from whisperx.asr import FasterWhisperPipeline
from whisperx.audio import N_SAMPLES, log_mel_spectrogram
from whisperx.utils import get_writer


model = None
alignment_models = {}
model_root = os.environ.get("HF_HOME", "/media/downloads/.karaoke-eternal-models")


def detect_language_from_middle(self, audio):
    """Detect language from the main vocal section, not an instrumental intro."""
    start_sample = max(0, (audio.shape[0] - N_SAMPLES) // 2)
    language_sample = audio[start_sample:start_sample + N_SAMPLES]
    model_n_mels = self.model.feat_kwargs.get("feature_size")
    segment = log_mel_spectrogram(
        language_sample,
        n_mels=model_n_mels if model_n_mels is not None else 80,
        padding=0 if audio.shape[0] >= N_SAMPLES else N_SAMPLES - audio.shape[0],
    )
    encoder_output = self.model.encode(segment)
    language_token, _language_probability = self.model.model.detect_language(encoder_output)[0][0]
    return language_token[2:-2]


FasterWhisperPipeline.detect_language = detect_language_from_middle


def emit(message):
    print(json.dumps(message), flush=True)


def mount(request):
    global model
    if model is None:
        settings = request["settings"]
        model = whisperx.load_model(
            settings["model"],
            device="cpu",
            compute_type="int8",
            language=settings.get("language"),
            asr_options={
                "beam_size": settings["beamSize"],
                "initial_prompt": settings.get("initialPrompt") or None,
                "condition_on_previous_text": False,
            },
            vad_method="silero",
            vad_options={"vad_onset": settings["vadOnset"], "chunk_size": 30},
            download_root=model_root,
        )
    emit({"id": request["id"], "event": "mounted"})


def transcribe(request):
    if model is None:
        # `transcribe` is normally preceded by an explicit mount request, but
        # this keeps the worker safe if it is called directly.
        mount({"id": request["id"], "settings": request["settings"]})

    def transcription_progress(percent):
        emit({"id": request["id"], "event": "progress", "progress": round(percent * 0.5, 2)})

    def alignment_progress(percent):
        emit({"id": request["id"], "event": "progress", "progress": round(50 + percent * 0.5, 2)})

    emit({"id": request["id"], "event": "stage", "stage": "Detecting vocals and language"})
    audio = whisperx.load_audio(request["audio"])
    result = model.transcribe(
        audio,
        batch_size=1,
        print_progress=False,
        progress_callback=transcription_progress,
    )
    language = result["language"]
    emit({"id": request["id"], "event": "stage", "stage": "Aligning lyric timings"})
    if language not in alignment_models:
        alignment_models[language] = whisperx.load_align_model(
            language,
            "cpu",
            model_dir=model_root,
        )
    align_model, align_metadata = alignment_models[language]
    result = whisperx.align(
        result["segments"],
        align_model,
        align_metadata,
        audio,
        "cpu",
        print_progress=False,
        progress_callback=alignment_progress,
    )
    result["language"] = language
    writer = get_writer("srt", request["outputDir"])
    # These are normally populated by WhisperX's command-line parser. The
    # persistent worker calls the writer directly, so retain the CLI defaults.
    writer(result, request["audio"], {
        "max_line_width": None,
        "max_line_count": None,
        "highlight_words": False,
    })
    srt_path = os.path.join(
        request["outputDir"],
        f"{os.path.splitext(os.path.basename(request['audio']))[0]}.srt",
    )
    emit({"id": request["id"], "event": "complete", "language": language, "srt": srt_path})


def unmount(request):
    global model, alignment_models
    model = None
    alignment_models = {}
    gc.collect()
    torch.cuda.empty_cache()
    emit({"id": request["id"], "event": "unmounted"})


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            command = request.get("command")
            if command == "mount":
                mount(request)
            elif command == "transcribe":
                transcribe(request)
            elif command == "unmount":
                unmount(request)
            elif command == "shutdown":
                unmount(request)
                return
            else:
                raise ValueError(f"Unknown command: {command}")
        except Exception as error:
            emit({
                "id": request.get("id") if "request" in locals() else None,
                "event": "error",
                "error": str(error),
                "traceback": traceback.format_exc(),
            })


if __name__ == "__main__":
    main()
