import { analyzeBpm } from './bpmAnalysis'

self.onmessage = (event: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => {
  try {
    self.postMessage({ result: analyzeBpm(event.data.channels, event.data.sampleRate) })
  } catch {
    self.postMessage({ error: true })
  }
}
