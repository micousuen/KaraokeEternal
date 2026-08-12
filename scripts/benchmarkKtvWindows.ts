import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { detectKtvTrack } from '../server/Media/KtvTrackDetector.js'

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

for (let windowSeconds = 1; windowSeconds <= 10; windowSeconds++) {
  let correct = 0
  let wrong = 0
  let unknown = 0
  let confidenceTotal = 0
  const errors: string[] = []

  for (const [filename, expected] of Object.entries(labels)) {
    const result = await detectKtvTrack(path.join(target, filename), windowSeconds)
    if (result.ktvTrack === null) {
      unknown++
      errors.push(`${filename}: unknown (expected A${expected + 1})`)
    } else if (result.ktvTrack === expected) {
      correct++
      confidenceTotal += result.confidence
    } else {
      wrong++
      errors.push(`${filename}: A${result.ktvTrack + 1} (expected A${expected + 1})`)
    }
  }

  const classified = correct + wrong
  console.log(JSON.stringify({
    windowSeconds,
    correct,
    wrong,
    unknown,
    coverage: Number((classified / Object.keys(labels).length).toFixed(3)),
    classifiedAccuracy: classified ? Number((correct / classified).toFixed(3)) : 0,
    averageCorrectConfidence: correct ? Number((confidenceTotal / correct).toFixed(3)) : 0,
    errors,
  }))
}
