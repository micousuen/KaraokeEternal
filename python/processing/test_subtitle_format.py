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
            (0, 1, "One.\nTwo.", 0),
            (1, 2, "Three.\nTwo.", 1),
            (2, 3, "Three.", 0),
        ])

    def test_repeated_lines_report_structural_active_row(self):
        # Identical text on both rows must not confuse the client. The emitted
        # active_row is computed structurally, so repeats alternate cleanly and
        # single-line tail cues report 0 (only line visible).
        result = {
            "language": "en",
            "segments": [{
                "start": 0,
                "end": 5,
                "words": [
                    {"word": "Chorus.", "start": 0, "end": 1},
                    {"word": "Chorus.", "start": 1, "end": 2},
                    {"word": "Chorus.", "start": 2, "end": 3},
                    {"word": "Chorus.", "start": 3, "end": 4},
                    {"word": "Chorus.", "start": 4, "end": 5},
                ],
            }],
        }
        active_rows = [active for _, _, _, active in rolling_cues(result, 36, 12)]
        # 5 identical lines → 5 cues. Cues 1..4 show both rows with alternating
        # active_row; cue 5 shows only the trailing line at displayed index 0.
        self.assertEqual(active_rows, [0, 1, 0, 1, 0])

    def test_single_line_group_after_gap_reports_row_zero(self):
        # A > 2s gap starts a fresh group. A group with only one line emits a
        # single cue where the only visible line is at displayed index 0.
        result = {
            "language": "en",
            "segments": [{
                "start": 0,
                "end": 1,
                "words": [{"word": "Solo.", "start": 0, "end": 1}],
            }, {
                "start": 10,
                "end": 11,
                "words": [{"word": "Alone.", "start": 10, "end": 11}],
            }],
        }
        cues = rolling_cues(result, 36, 12)
        # Two groups, each one line → two cues, each with active_row=0.
        self.assertEqual([(text, active) for _, _, text, active in cues], [
            ("Solo.", 0),
            ("Alone.", 0),
        ])

    def test_two_line_group_tail_reports_row_zero(self):
        # A 2-line group's second cue drops the top slot as the top line ends;
        # the surviving bottom line slides to displayed index 0.
        result = {
            "language": "en",
            "segments": [{
                "start": 0,
                "end": 2,
                "words": [
                    {"word": "First.", "start": 0, "end": 1},
                    {"word": "Second.", "start": 1, "end": 2},
                ],
            }],
        }
        cues = rolling_cues(result, 36, 12)
        self.assertEqual([(text, active) for _, _, text, active in cues], [
            ("First.\nSecond.", 0),
            ("Second.", 0),
        ])


if __name__ == "__main__":
    unittest.main()
