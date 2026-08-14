"""Pure lyric line wrapping and rolling-SRT formatting."""

import re


def format_srt_timestamp(seconds):
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def normalized_text(text):
    return "".join(character.casefold() for character in text if character.isalnum())


def read_srt_segments(filename):
    """Read creator captions as alignment-ready segments, removing music markup."""
    with open(filename, encoding="utf-8-sig") as source:
        content = source.read().replace("\r\n", "\n")

    segments = []
    for block in re.split(r"\n{2,}", content.strip()):
        lines = block.splitlines()
        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        match = re.match(r"\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})", lines[timing_index])
        if not match:
            continue
        values = [int(value) for value in match.groups()]
        start = values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000
        end = values[4] * 3600 + values[5] * 60 + values[6] + values[7] / 1000
        text = " ".join(lines[timing_index + 1:])
        text = re.sub(r"<[^>]+>", " ", text).replace("♪", " ")
        text = re.sub(r"\[[^\]]+\]", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if end > start and normalized_text(text):
            segments.append({"start": start, "end": end, "text": text})
    return segments


def preserve_unaligned_text(raw_segments, aligned_segments):
    """Restore a raw ASR segment if forced alignment dropped any of its text."""
    buckets = [[] for _ in raw_segments]
    raw_index = 0
    for aligned in aligned_segments:
        start = aligned.get("start")
        end = aligned.get("end")
        if start is None or end is None:
            continue
        for index in range(raw_index, len(raw_segments)):
            raw = raw_segments[index]
            if start > raw["end"] + 0.05:
                raw_index = index + 1
                continue
            if start >= raw["start"] - 0.05 and end <= raw["end"] + 0.05:
                buckets[index].append(aligned)
                raw_index = index
            break

    preserved = []
    for raw, aligned in zip(raw_segments, buckets):
        raw_coverage = normalized_text(raw.get("text", ""))
        aligned_coverage = normalized_text("".join(segment.get("text", "") for segment in aligned))
        if raw_coverage and raw_coverage != aligned_coverage:
            preserved.append({
                "text": raw["text"],
                "start": raw["start"],
                "end": raw["end"],
                "words": [],
            })
        else:
            preserved.extend(aligned)
    return preserved


def timed_words(result):
    """Return aligned words, estimating a segment only if it has no word timings."""
    words = []
    no_spaces = result["language"] in {"zh", "yue", "ja", "ko", "th"}
    for segment in result["segments"]:
        segment_words = segment.get("words") or []
        if not segment_words:
            text = segment.get("text", "").strip()
            units = list(text) if no_spaces else text.split()
            segment_words = [{"word": word} for word in units]
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
    """Wrap aligned words into readable lyric lines without losing timing."""
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
            if current_width >= min_width:
                add_line()
                current = []
                current_width = 0
            else:
                carry_short_comma = True
    if current:
        add_line()
    return lines


def rolling_cues(result, max_width, min_width):
    """Build two independently advancing lyric rows.

    Yields (start, end, text, active_row) — active_row is the 0-based index of
    the currently-singing line within `text.split("\\n")`. Encoding this
    explicitly avoids the client having to diff consecutive cues to guess which
    row is active, which is unreliable when two rows share identical text.
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
                # active_row is the index into `displayed`, not into (top, bottom).
                # If only bottom remains, it slides up to index 0.
                active_row = 0 if ending_top or top is None else 1
                cues.append((current_time, ending["end"], "\n".join(displayed), active_row))
            current_time = ending["end"]
            replacement = group[next_line] if next_line < len(group) else None
            next_line += 1
            if ending_top:
                top = replacement
            else:
                bottom = replacement
    return cues


def write_rolling_srt(result, output_path, max_width, min_width):
    with open(output_path, "w", encoding="utf-8") as output:
        for index, (start, end, text, active_row) in enumerate(rolling_cues(result, max_width, min_width), start=1):
            # `A<row>` is appended after the timing arrow. Standard SRT parsers
            # take only the two timestamps from this line and ignore trailing
            # tokens, so external players remain compatible.
            output.write(
                f"{index}\n{format_srt_timestamp(start)} --> {format_srt_timestamp(end)} A{active_row}\n{text}\n\n"
            )
