import os
import tempfile
import unittest

from subtitle_format import lyric_lines, preserve_unaligned_text, read_srt_segments, rolling_cues


class SubtitleFormatTests(unittest.TestCase):
    def test_reads_creator_srt_and_removes_music_markup(self):
        content = "1\n00:00:01,000 --> 00:00:02,000\n[Music]\n\n2\n00:00:07,133 --> 00:00:12,266\n♪ <b>SPENT 24 HOURS</b> ♪\n\n"
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as source:
            source.write(content)
            filename = source.name
        try:
            self.assertEqual(read_srt_segments(filename), [{
                "start": 7.133,
                "end": 12.266,
                "text": "SPENT 24 HOURS",
            }])
        finally:
            os.unlink(filename)

    def test_preserves_raw_segment_when_alignment_drops_text(self):
        raw = [{"start": 0, "end": 2, "text": "complete lyric"}]
        aligned = [{"start": 0, "end": 1, "text": "complete", "words": []}]
        self.assertEqual(preserve_unaligned_text(raw, aligned), [{
            "start": 0,
            "end": 2,
            "text": "complete lyric",
            "words": [],
        }])

    def test_chinese_phrase_break_respects_minimum_width(self):
        result = {
            "language": "zh",
            "segments": [{
                "start": 0,
                "end": 4,
                "words": [
                    {"word": "你好，", "start": 0, "end": 1},
                    {"word": "这是", "start": 1, "end": 2},
                    {"word": "一句。", "start": 2, "end": 3},
                ],
            }],
        }
        self.assertEqual(
            [line["text"] for line in lyric_lines(result, 10, 4)],
            ["你好，这是一句。"],
        )

    def test_rolling_rows_advance_independently(self):
        result = {
            "language": "en",
            "segments": [{
                "start": 0,
                "end": 3,
                "words": [
                    {"word": "One.", "start": 0, "end": 1},
                    {"word": "Two.", "start": 1, "end": 2},
                    {"word": "Three.", "start": 2, "end": 3},
                ],
            }],
        }
        self.assertEqual(rolling_cues(result, 36, 12), [
            (0, 1, "One.\nTwo."),
            (1, 2, "Three.\nTwo."),
            (2, 3, "Three."),
        ])


if __name__ == "__main__":
    unittest.main()
