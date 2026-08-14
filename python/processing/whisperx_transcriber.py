"""WhisperX model lifecycle and transcription pipeline."""

import gc
import os

import torch
import whisperx
from whisperx.asr import FasterWhisperPipeline
from whisperx.audio import N_SAMPLES, log_mel_spectrogram

from subtitle_format import preserve_unaligned_text, read_srt_segments, write_rolling_srt


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


class WhisperXTranscriber:
    def __init__(self, model_root):
        self.model_root = model_root
        self.model = None
        self.alignment_models = {}

    def mount(self, settings):
        if self.model is not None:
            return
        self.model = whisperx.load_model(
            settings["model"],
            device="cpu",
            compute_type="int8",
            language=settings.get("language"),
            asr_options={
                "beam_size": settings["beamSize"],
                "patience": settings.get("patience", 1),
                "length_penalty": settings.get("lengthPenalty", 1),
                "initial_prompt": settings.get("initialPrompt") or None,
                "condition_on_previous_text": False,
            },
            vad_method="silero",
            vad_options={
                "vad_onset": settings["vadOnset"],
                "vad_offset": settings.get("vadOffset", settings["vadOnset"] - 0.15),
                "chunk_size": settings["vadChunkSeconds"],
            },
            download_root=self.model_root,
        )

    def transcribe(
        self,
        audio_path,
        output_dir,
        settings,
        emit,
        caption_path=None,
        caption_language=None,
    ):
        if self.model is None and not caption_path:
            self.mount(settings)

        def transcription_progress(percent):
            emit("progress", progress=round(percent * 0.5, 2))

        def alignment_progress(percent):
            emit("progress", progress=round(50 + percent * 0.5, 2))

        audio = whisperx.load_audio(audio_path)
        if caption_path:
            emit("stage", stage="Loading creator-provided captions")
            raw_segments = read_srt_segments(caption_path)
        else:
            raw_segments = []
        if raw_segments:
            language = caption_language or "en"
            emit("progress", progress=50)
        else:
            if caption_path:
                emit("stage", stage="Creator captions contain no lyrics; using WhisperX")
                self.mount(settings)
            else:
                emit("stage", stage="Detecting vocals and language")
            result = self.model.transcribe(
                audio,
                batch_size=int(settings.get("batchSize", 2)),
                chunk_size=settings["vadChunkSeconds"],
                print_progress=False,
                progress_callback=transcription_progress,
            )
            language = result["language"]
            raw_segments = result["segments"]
        emit("stage", stage="Aligning lyric timings")
        alignment_language = language
        if alignment_language not in self.alignment_models:
            try:
                self.alignment_models[alignment_language] = whisperx.load_align_model(
                    alignment_language, "cpu", model_dir=self.model_root,
                )
            except ValueError as error:
                if "No default align-model for language:" not in str(error) or alignment_language == "en":
                    raise
                alignment_language = "en"
                emit("stage", stage=f"No {language} alignment model; using English alignment")
                if alignment_language not in self.alignment_models:
                    self.alignment_models[alignment_language] = whisperx.load_align_model(
                        alignment_language, "cpu", model_dir=self.model_root,
                    )
        align_model, align_metadata = self.alignment_models[alignment_language]
        result = whisperx.align(
            raw_segments,
            align_model,
            align_metadata,
            audio,
            "cpu",
            print_progress=False,
            progress_callback=alignment_progress,
        )
        result["segments"] = preserve_unaligned_text(raw_segments, result["segments"])
        result["language"] = language
        srt_path = os.path.join(output_dir, f"{os.path.splitext(os.path.basename(audio_path))[0]}.srt")
        max_line_width = settings["maxLineWidth"]
        min_line_width = settings.get("minLineWidth", 12)
        if language in {"zh", "yue"}:
            max_line_width = max(1, max_line_width // 2)
            min_line_width = max(1, min_line_width // 2)
        write_rolling_srt(result, srt_path, max_line_width, min_line_width)
        return {"language": language, "srt": srt_path}

    def unmount(self):
        self.model = None
        self.alignment_models = {}
        gc.collect()
        torch.cuda.empty_cache()
