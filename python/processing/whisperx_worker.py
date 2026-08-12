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


def format_srt_timestamp(seconds):
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def timed_words(result):
    """Return aligned words, estimating a segment only if it has no word timings."""
    words = []
    for segment in result["segments"]:
        segment_words = segment.get("words") or []
        if not segment_words:
            segment_words = [{"word": word} for word in segment.get("text", "").split()]
        visible_words = [word for word in segment_words if word.get("word", "").strip()]
        if not visible_words:
            continue
        duration = max(0, segment["end"] - segment["start"])
        for index, word in enumerate(visible_words):
            start = word.get("start")
            end = word.get("end")
            if start is None or end is None:
                start = segment["start"] + duration * index / len(visible_words)
                end = segment["start"] + duration * (index + 1) / len(visible_words)
            words.append({"text": word["word"].strip(), "start": start, "end": end})
    return words


def lyric_lines(result, max_width, min_width):
    """Wrap aligned words into readable lyric lines without losing their timing."""
    def is_sentence_end(text):
        return text.rstrip('”"\'»)]}').endswith((".", "。"))

    def is_phrase_end(text):
        return text.rstrip('”"\'»)]}').endswith((",", "，", "、", "!", "?", "！", "？"))

    def add_line():
        lines.append({
            "text": "".join(item["text"] for item in current) if no_spaces else " ".join(item["text"] for item in current),
            "start": current[0]["start"],
            "end": current[-1]["end"],
        })

    no_spaces = result["language"] in {"zh", "yue", "ja", "ko", "th"}
    lines = []
    current = []
    current_width = 0
    carry_short_comma = False
    for word in timed_words(result):
        separator_width = 0 if no_spaces or not current else 1
        word_width = len(word["text"])
        pause_before_word = word["start"] - current[-1]["end"] if current else 0
        # Chinese ASR commonly omits sentence punctuation. A vocal pause is a
        # better lyric-phrase boundary than filling every row to its limit.
        natural_phrase_break = (
            no_spaces
            and current_width >= max_width / 2
            and pause_before_word >= 0.45
            and not carry_short_comma
        )
        if current and (natural_phrase_break or current_width + separator_width + word_width > max_width):
            add_line()
            current = []
            current_width = 0
            separator_width = 0
        current.append(word)
        current_width += separator_width + word_width
        carry_short_comma = False
        if is_sentence_end(word["text"]):
            add_line()
            current = []
            current_width = 0
        elif no_spaces and is_phrase_end(word["text"]):
            # Prefer a new lyric row at commas and exclamation/question marks.
            # Keep a short leading phrase below the configured minimum with
            # what follows so it remains readable.
            if current_width >= min_width:
                add_line()
                current = []
                current_width = 0
            else:
                carry_short_comma = True
    if current:
        add_line()
    return lines


def write_rolling_srt(result, output_path, max_width, min_width):
    """Write two independently advancing lyric rows from word-level alignment.

    The next two lines are visible. When the top row ends it is replaced while
    the bottom row stays; when the bottom row ends, only that row advances.
    """
    lines = lyric_lines(result, max_width, min_width)
    groups = []
    for line in lines:
        if not groups or line["start"] - groups[-1][-1]["end"] > 2:
            groups.append([line])
        else:
            groups[-1].append(line)

    cues = []
    for group in groups:
        top = group[0]
        bottom = group[1] if len(group) > 1 else None
        next_line = 2
        current_time = top["start"]
        while top or bottom:
            ending_top = top is not None and (bottom is None or top["end"] <= bottom["end"])
            ending = top if ending_top else bottom
            if ending["end"] > current_time:
                displayed = [line["text"] for line in (top, bottom) if line is not None]
                cues.append((current_time, ending["end"], "\n".join(displayed)))
            current_time = ending["end"]
            replacement = group[next_line] if next_line < len(group) else None
            next_line += 1
            if ending_top:
                top = replacement
            else:
                bottom = replacement

    with open(output_path, "w", encoding="utf-8") as output:
        for index, (start, end, text) in enumerate(cues, start=1):
            output.write(f"{index}\n{format_srt_timestamp(start)} --> {format_srt_timestamp(end)}\n{text}\n\n")


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
    alignment_language = language
    if alignment_language not in alignment_models:
        try:
            alignment_models[alignment_language] = whisperx.load_align_model(
                alignment_language,
                "cpu",
                model_dir=model_root,
            )
        except ValueError as error:
            if "No default align-model for language:" not in str(error) or alignment_language == "en":
                raise
            alignment_language = "en"
            emit({
                "id": request["id"],
                "event": "stage",
                "stage": f"No {language} alignment model; using English alignment",
            })
            if alignment_language not in alignment_models:
                alignment_models[alignment_language] = whisperx.load_align_model(
                    alignment_language,
                    "cpu",
                    model_dir=model_root,
                )
    align_model, align_metadata = alignment_models[alignment_language]
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
    srt_path = os.path.join(
        request["outputDir"],
        f"{os.path.splitext(os.path.basename(request['audio']))[0]}.srt",
    )
    max_line_width = request["settings"]["maxLineWidth"]
    min_line_width = request["settings"].get("minLineWidth", 12)
    # CJK captions read best with substantially shorter rows. Chinese and
    # Cantonese do not spend characters on inter-word spaces, so halve the
    # normal limit before the rolling-line timing is generated.
    if language in {"zh", "yue"}:
        max_line_width = max(1, max_line_width // 2)
        min_line_width = max(1, min_line_width // 2)
    write_rolling_srt(result, srt_path, max_line_width, min_line_width)
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
