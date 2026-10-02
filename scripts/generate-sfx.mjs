import { mkdir, writeFile } from 'node:fs/promises'

const sampleRate = 44100
const destination = new URL('../public/assets/sfx/', import.meta.url)
const sounds = {
  hover: { duration: .045, notes: [] },
  press: { duration: .075, notes: [[420, 0, .055, .16], [720, .018, .05, .08]] },
  confirm: { duration: .16, notes: [[620, 0, .09, .15], [930, .055, .105, .13]] },
  back: { duration: .12, notes: [[620, 0, .07, .12], [390, .045, .075, .13]] },
  toggle: { duration: .09, notes: [[540, 0, .045, .12], [760, .03, .06, .1]] },
  tick: { duration: .025, notes: [[1100, 0, .025, .1]] },
  danger: { duration: .18, notes: [[250, 0, .11, .16], [185, .07, .11, .15]] },
}

function wave({ duration, notes }) {
  const frames = Math.ceil(duration * sampleRate)
  const data = Buffer.alloc(frames * 2)
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / sampleRate
    let value = 0
    for (const [frequency, start, length, gain] of notes) {
      if (time < start || time >= start + length) continue
      const phase = (time - start) / length
      const envelope = Math.sin(Math.PI * phase) ** .7
      value += Math.sin(2 * Math.PI * frequency * time) * envelope * gain
    }
    data.writeInt16LE(Math.max(-1, Math.min(1, value)) * 32767, frame * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

await mkdir(destination, { recursive: true })
await Promise.all(Object.entries(sounds).map(([name, definition]) => writeFile(new URL(`${name}.wav`, destination), wave(definition))))
