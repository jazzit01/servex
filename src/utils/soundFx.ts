import { usePosStore } from '../store/usePosStore'

let context: AudioContext | undefined
const patterns = { click: [390], kot: [660,880], paid: [523,659,784] }
export function soundFx(event: keyof typeof patterns) {
  if (!usePosStore.getState().data?.settings.sound_enabled || !window.AudioContext) return
  try {
    context ??= new AudioContext()
    const audio = context
    void audio.resume().then(() => {
      patterns[event].forEach((frequency,index) => {
        const start = audio.currentTime + index * .065
        const tone = audio.createOscillator()
        const gain = audio.createGain()
        tone.frequency.value = frequency
        tone.connect(gain).connect(audio.destination)
        gain.gain.setValueAtTime(.0001,start)
        gain.gain.exponentialRampToValueAtTime(.038,start+.015)
        gain.gain.exponentialRampToValueAtTime(.0001,start+.13)
        tone.start(start); tone.stop(start+.14)
      })
    }).catch(() => {})
  } catch { /* UI remains usable without audio. */ }
}
