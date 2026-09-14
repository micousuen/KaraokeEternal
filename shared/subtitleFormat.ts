export interface TranscriptWord {
  end: number
  start: number
  text: string
  type: 'audio_event' | 'spacing' | 'word'
}

interface TimedWord {
  end: number
  start: number
  text: string
}

interface LyricWord extends TimedWord {
  characterEnd: number
  characterStart: number
}

interface LyricLine extends TimedWord {
  words: LyricWord[]
}

export interface RollingCue extends TimedWord {
  activeEnd: number
  activeRow: number
  activeStart: number
  activeWordEnd: number
  activeWordStart: number
}

const NO_SPACE_LANGUAGES = new Set([
  'ja', 'jpn', 'ko', 'kor', 'lo', 'lao', 'my', 'mya', 'th', 'tha', 'yue', 'zh', 'zho',
])

export function createRollingSrt (
  words: TranscriptWord[],
  language: string,
  maxWidth: number,
  minWidth: number,
): string {
  return rollingCues(words, language, maxWidth, minWidth)
    .map((cue, index) => [
      index + 1,
      `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)} A${cue.activeRow} C${cue.activeStart}-${cue.activeEnd} P${Math.round(cue.activeWordStart * 1000)}-${Math.round(cue.activeWordEnd * 1000)}`,
      cue.text,
      '',
    ].join('\n'))
    .join('\n')
}

export function rollingCues (
  words: TranscriptWord[],
  language: string,
  maxWidth: number,
  minWidth: number,
): RollingCue[] {
  const lines = lyricLines(words, language, maxWidth, minWidth)
  const groups: LyricLine[][] = []
  for (const line of lines) {
    const lastGroup = groups.at(-1)
    if (!lastGroup || line.start - lastGroup.at(-1)!.end > 2) groups.push([line])
    else lastGroup.push(line)
  }

  const cues: RollingCue[] = []
  for (const group of groups) {
    let top: LyricLine | undefined = group[0]
    let bottom: LyricLine | undefined = group[1]
    let nextLine = 2
    let currentTime = top.start
    while (top || bottom) {
      const endingTop = top !== undefined && (bottom === undefined || top.end <= bottom.end)
      const ending = endingTop ? top! : bottom!
      if (ending.end > currentTime) {
        const displayed = [top, bottom].filter((line): line is LyricLine => line !== undefined)
        const activeRow = endingTop || top === undefined ? 0 : 1
        const text = displayed.map(line => line.text).join('\n')
        let wordStart = currentTime
        ending.words.forEach((word, index) => {
          const nextWord = ending.words[index + 1]
          const wordEnd = nextWord ? Math.min(ending.end, Math.max(wordStart, nextWord.start)) : ending.end
          if (wordEnd > wordStart) {
            cues.push({
              activeEnd: word.characterEnd,
              activeRow,
              activeStart: word.characterStart,
              activeWordEnd: word.end,
              activeWordStart: word.start,
              end: wordEnd,
              start: wordStart,
              text,
            })
          }
          wordStart = wordEnd
        })
      }
      currentTime = ending.end
      const replacement = group[nextLine++]
      if (endingTop) top = replacement
      else bottom = replacement
    }
  }
  return cues
}

export function lyricLines (
  words: TranscriptWord[],
  language: string,
  maxWidth: number,
  minWidth: number,
): LyricLine[] {
  const noSpaces = NO_SPACE_LANGUAGES.has(language.toLowerCase())
  const lines: LyricLine[] = []
  let current: TimedWord[] = []
  let currentWidth = 0
  let carryShortComma = false
  const addLine = () => {
    let characterOffset = 0
    const lineWords = current.map((word, index) => {
      if (!noSpaces && index > 0) characterOffset++
      const lineWord = {
        ...word,
        characterEnd: characterOffset + word.text.length,
        characterStart: characterOffset,
      }
      characterOffset = lineWord.characterEnd
      return lineWord
    })
    lines.push({
      end: current.at(-1)!.end,
      start: current[0].start,
      text: current.map(word => word.text).join(noSpaces ? '' : ' '),
      words: lineWords,
    })
  }

  for (const word of timedWords(words)) {
    let separatorWidth = noSpaces || !current.length ? 0 : 1
    const pauseBeforeWord = current.length ? word.start - current.at(-1)!.end : 0
    const naturalPhraseBreak = noSpaces
      && currentWidth >= maxWidth / 2
      && pauseBeforeWord >= 0.45
      && !carryShortComma
    if (current.length && (naturalPhraseBreak || currentWidth + separatorWidth + word.text.length > maxWidth)) {
      addLine()
      current = []
      currentWidth = 0
      separatorWidth = 0
    }
    current.push(word)
    currentWidth += separatorWidth + word.text.length
    carryShortComma = false
    if (isSentenceEnd(word.text)) {
      addLine()
      current = []
      currentWidth = 0
    } else if (noSpaces && isPhraseEnd(word.text)) {
      if (currentWidth >= minWidth) {
        addLine()
        current = []
        currentWidth = 0
      } else carryShortComma = true
    }
  }
  if (current.length) addLine()
  return lines
}

export function formatSrtTimestamp (seconds: number): string {
  let milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  milliseconds %= 3_600_000
  const minutes = Math.floor(milliseconds / 60_000)
  milliseconds %= 60_000
  const wholeSeconds = Math.floor(milliseconds / 1000)
  milliseconds %= 1000
  return [hours, minutes, wholeSeconds].map(value => String(value).padStart(2, '0')).join(':')
    + `,${String(milliseconds).padStart(3, '0')}`
}

export interface KaraokeWord {
  end: number
  start: number
  text: string
}

/** Convert edited words into generator transcript input, in time order. */
export function wordsToTranscript (words: KaraokeWord[]): TranscriptWord[] {
  return words
    .filter(word => word.text.trim() && Number.isFinite(word.start) && Number.isFinite(word.end)
      && word.end > word.start)
    .sort((a, b) => a.start - b.start)
    .map(word => ({ end: word.end, start: word.start, text: word.text.trim(), type: 'word' }))
}

/**
 * Extract the timed word list encoded in generated karaoke SRT cues. Cues
 * without the A/C/P word metadata (legacy scripts) are skipped.
 */
export function parseKaraokeWords (source: string): KaraokeWord[] {
  return source.trim().split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/)
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    if (timingIndex === -1) return []
    const [, rest] = lines[timingIndex].split('-->')
    const activeMatch = rest.match(/\bA(\d+)\b/)
    const characterMatch = rest.match(/\bC(\d+)-(\d+)\b/)
    const progressMatch = rest.match(/\bP(\d+)-(\d+)\b/)
    if (!activeMatch || !characterMatch || !progressMatch) return []
    const activeLine = lines[timingIndex + 1 + Number(activeMatch[1])]
    if (activeLine === undefined) return []
    const text = activeLine.slice(Number(characterMatch[1]), Number(characterMatch[2])).trim()
    const start = Number(progressMatch[1]) / 1000
    const end = Number(progressMatch[2]) / 1000
    return text && end > start ? [{ text, start, end }] : []
  })
}

function timedWords (words: TranscriptWord[]): TimedWord[] {
  return words.flatMap((word) => {
    const text = word.text.trim()
    return word.type === 'word' && text && Number.isFinite(word.start) && Number.isFinite(word.end)
      && word.end > word.start
      ? [{ text, start: word.start, end: word.end }]
      : []
  })
}

function isSentenceEnd (text: string): boolean {
  return text.replace(/[”"'»\])}]+$/u, '').endsWith('.') || text.replace(/[”"'»\])}]+$/u, '').endsWith('。')
}

function isPhraseEnd (text: string): boolean {
  return /[,，、!?！？][”"'»\])}]*$/u.test(text)
}
