import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { detectKtvTrack, type KtvDetectorOptions, type KtvTrackDetection } from '../server/Media/KtvTrackDetector.js'

const target = process.argv[2] || 'test_folder/media'
await fsPromises.access(target)
const labels: Record<string, 0 | 1> = {
  '1976-烟火(MTV)-国语-流行.mkv': 1,
  'ALEXANDRA BURKE-ALL NIGHT LONG(MTV)-英语-流行歌曲.mkv': 1,
  'ALICIA KEYS-KARMA(风景)-英语-流行歌曲.mkv': 0,
  'ALLSTAR WEEKEND-DANCE FOREVER(MTV)-英语-流行歌曲.mkv': 1,
  'B.A.D.-我没对她说(MTV)-国语-流行.mkv': 1,
  'B.A.D.-我的错(MTV)-国语-流行.mkv': 1,
  'B.A.D.-爱上了坏(MTV)-国语-流行.mkv': 1,
  'B.A.D.-爱有你(MTV)-国语-流行.mkv': 1,
  'B.A.D.-皇后之歌(演唱会)-国语-流行.mkv': 1,
  'B.A.D.-青春舞曲2001(MTV)-国语-流行.mkv': 1,
  'BEYOND-半斤八两-粤语-流行.mkv': 1,
  'Babystop 山竹-南征北伐-国语-流行.mkv': 1,
  'BigYear大年-隔壁班的女孩-国语-流行.mkv': 1,
}
const bands = [[250, 3400], [300, 3000]] as const
const rawRuns: { options: KtvDetectorOptions, results: Record<string, KtvTrackDetection> }[] = []

for (const windowSeconds of [3, 4, 5, 6]) {
  for (const smoothingFrames of [1, 2, 3]) {
    for (const lagFrames of [1, 2, 4]) {
      for (const [vocalLowHz, vocalHighHz] of bands) {
        const options = {
          windowSeconds,
          smoothingFrames,
          lagFrames,
          vocalLowHz,
          vocalHighHz,
          minimumAgreement: 0,
          minimumComplexity: 0,
        }
        const results: Record<string, KtvTrackDetection> = {}
        for (const filename of Object.keys(labels)) {
          results[filename] = await detectKtvTrack(path.join(target, filename), options)
        }
        rawRuns.push({ options, results })
      }
    }
  }
}

const scored = rawRuns.flatMap(run => [0.5, 0.55, 0.6].flatMap(minimumAgreement =>
  [0.001, 0.002, 0.003, 0.004].map((minimumComplexity) => {
    let correct = 0
    let wrong = 0
    let unknown = 0
    let confidence = 0
    const errors: string[] = []
    for (const [filename, expected] of Object.entries(labels)) {
      const result = run.results[filename]
      const classified = result.agreement >= minimumAgreement
        && Math.abs(result.complexityDifference) >= minimumComplexity
      if (!classified) unknown++
      else if (result.ktvTrack === expected) {
        correct++
        confidence += result.confidence
      } else {
        wrong++
        errors.push(filename)
      }
    }
    return {
      options: { ...run.options, minimumAgreement, minimumComplexity },
      correct,
      wrong,
      unknown,
      averageConfidence: correct ? confidence / correct : 0,
      errors,
    }
  }),
))

scored.sort((a, b) =>
  a.wrong - b.wrong
  || b.correct - a.correct
  || b.averageConfidence - a.averageConfidence,
)

for (const result of scored.slice(0, 15)) {
  console.log(JSON.stringify({
    ...result,
    averageConfidence: Number(result.averageConfidence.toFixed(3)),
  }))
}

console.log(JSON.stringify({
  perfectSettings: scored.filter(result => result.correct === 13).length,
  structuralSettingsTested: rawRuns.length,
  totalSettingsTested: scored.length,
}))
