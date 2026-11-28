import { useLayoutEffect, useRef } from 'react'
import { create } from 'zustand'

export type CalculatorAction = { kind: 'charge'; name: string; amount: number } |
  { kind: 'discount' | 'tender'; amount: number }

type Bridge = (action: CalculatorAction) => void
export const useCalculatorBridge = create<{ apply: Bridge | null }>(() => ({ apply: null }))

export function useCalculatorActions(enabled: boolean, apply: Bridge) {
  const current = useRef(apply)
  current.current = apply
  useLayoutEffect(() => {
    if (!enabled) return
    const handler: Bridge = action => current.current(action)
    useCalculatorBridge.setState({ apply: handler })
    return () => {
      if (useCalculatorBridge.getState().apply === handler) useCalculatorBridge.setState({ apply: null })
    }
  }, [enabled])
}
