"""Lossless conversion of VAD speech regions into bounded ASR chunks."""


def lossless_speech_chunks(segments, chunk_size):
    """Return chunks no longer than chunk_size without dropping detected speech."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero")

    pieces = []
    for segment in segments:
        start = float(segment.start)
        end = float(segment.end)
        while start < end:
            piece_end = min(end, start + chunk_size)
            pieces.append((start, piece_end))
            start = piece_end

    # Combine short neighboring regions when their complete time span still
    # fits. The span may contain intentional silence, but every detected speech
    # sample remains covered exactly once.
    merged = []
    for start, end in pieces:
        if merged and end - merged[-1]["start"] <= chunk_size:
            merged[-1]["end"] = end
            merged[-1]["segments"].append((start, end))
        else:
            merged.append({
                "start": start,
                "end": end,
                "segments": [(start, end)],
            })
    return merged
