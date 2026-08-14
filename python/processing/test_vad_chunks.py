import unittest
from types import SimpleNamespace

from vad_chunks import lossless_speech_chunks


class VadChunkTests(unittest.TestCase):
    def test_splits_continuous_speech_without_gaps(self):
        chunks = lossless_speech_chunks([
            SimpleNamespace(start=15.2, end=234.2),
        ], 15)

        self.assertEqual(chunks[0]["start"], 15.2)
        self.assertEqual(chunks[-1]["end"], 234.2)
        self.assertTrue(all(chunk["end"] - chunk["start"] <= 15 + 1e-9 for chunk in chunks))
        self.assertTrue(all(
            left["end"] == right["start"]
            for left, right in zip(chunks, chunks[1:])
        ))

    def test_merges_short_regions_that_fit_in_one_chunk(self):
        chunks = lossless_speech_chunks([
            SimpleNamespace(start=1, end=4),
            SimpleNamespace(start=6, end=10),
            SimpleNamespace(start=20, end=22),
        ], 15)

        self.assertEqual(chunks, [
            {"start": 1.0, "end": 10.0, "segments": [(1.0, 4.0), (6.0, 10.0)]},
            {"start": 20.0, "end": 22.0, "segments": [(20.0, 22.0)]},
        ])

    def test_empty_vad_result_stays_empty(self):
        self.assertEqual(lossless_speech_chunks([], 15), [])


if __name__ == "__main__":
    unittest.main()
