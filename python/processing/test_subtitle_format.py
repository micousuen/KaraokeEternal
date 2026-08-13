import unittest

from subtitle_format import lyric_lines, preserve_unaligned_text, rolling_cues


class SubtitleFormatTests(unittest.TestCase):
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
