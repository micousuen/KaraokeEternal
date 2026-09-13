import { describe, expect, it } from 'vitest'
import { createRollingSrt, lyricLines, rollingCues, type TranscriptWord } from './SubtitleFormat.js'

const words = (values: Array<[string, number, number]>): TranscriptWord[] => values.map(([text, start, end]) => ({
  end,
  start,
  text,
  type: 'word',
}))

describe('lyricLines', () => {
  it('wraps western lyrics without spacing response entries', () => {
    expect(lyricLines(words([
      ['One', 0, 0.5], ['two', 0.5, 1], ['three', 1, 1.5],
    ]), 'en', 7, 4).map(line => line.text)).toEqual(['One two', 'three'])
  })

  it('respects the minimum width at Chinese phrase breaks', () => {
    expect(lyricLines(words([
      ['你好，', 0, 1], ['这是', 1, 2], ['一句。', 2, 3],
    ]), 'zho', 10, 4).map(line => line.text)).toEqual(['你好，这是一句。'])
  })

  it('ignores spacing and audio-event entries', () => {
    const transcript: TranscriptWord[] = [
      { text: 'Hello', start: 0, end: 0.5, type: 'word' },
      { text: ' ', start: 0.5, end: 0.5, type: 'spacing' },
      { text: '(music)', start: 0.5, end: 1, type: 'audio_event' },
      { text: 'world!', start: 1, end: 1.5, type: 'word' },
    ]
    expect(lyricLines(transcript, 'en', 36, 12).map(line => line.text)).toEqual(['Hello world!'])
  })
})

describe('rollingCues', () => {
  it('advances two rows independently', () => {
    expect(rollingCues(words([
      ['One.', 0, 1], ['Two.', 1, 2], ['Three.', 2, 3],
    ]), 'en', 36, 12)).toEqual([
      { start: 0, end: 1, text: 'One.\nTwo.', activeRow: 0, activeStart: 0, activeEnd: 4, activeWordStart: 0, activeWordEnd: 1 },
      { start: 1, end: 2, text: 'Three.\nTwo.', activeRow: 1, activeStart: 0, activeEnd: 4, activeWordStart: 1, activeWordEnd: 2 },
      { start: 2, end: 3, text: 'Three.', activeRow: 0, activeStart: 0, activeEnd: 6, activeWordStart: 2, activeWordEnd: 3 },
    ])
  })

  it('advances the active character range at every word timestamp', () => {
    expect(rollingCues(words([
      ['Sing', 0, 0.4], ['with', 0.5, 0.9], ['me', 1, 1.4],
    ]), 'en', 36, 12)).toEqual([
      { start: 0, end: 0.5, text: 'Sing with me', activeRow: 0, activeStart: 0, activeEnd: 4, activeWordStart: 0, activeWordEnd: 0.4 },
      { start: 0.5, end: 1, text: 'Sing with me', activeRow: 0, activeStart: 5, activeEnd: 9, activeWordStart: 0.5, activeWordEnd: 0.9 },
      { start: 1, end: 1.4, text: 'Sing with me', activeRow: 0, activeStart: 10, activeEnd: 12, activeWordStart: 1, activeWordEnd: 1.4 },
    ])
  })

  it('reports row zero for a repeated-line tail', () => {
    const cues = rollingCues(words([
      ['Chorus.', 0, 1], ['Chorus.', 1, 2], ['Chorus.', 2, 3],
      ['Chorus.', 3, 4], ['Chorus.', 4, 5],
    ]), 'en', 36, 12)
    expect(cues.map(cue => cue.activeRow)).toEqual([0, 1, 0, 1, 0])
  })
})

it('writes the custom active-row marker into valid SRT timing lines', () => {
  expect(createRollingSrt(words([['Hello.', 1.2345, 2.5]]), 'en', 36, 12)).toBe(
    '1\n00:00:01,235 --> 00:00:02,500 A0 C0-6 P1235-2500\nHello.\n',
  )
})
