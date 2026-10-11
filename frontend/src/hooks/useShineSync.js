import { useLayoutEffect } from 'react'

// Pin every goal-shine animation to the same clock (page load), so blocks that
// render later — Google events arriving after local ones, a new week — fall into
// the same wave instead of starting their own. Each block's place in the wave is
// its CSS animation-delay; only the shared start is set here. Browsers without
// getAnimations() just start the blocks as they mount, which still lines up for
// everything rendered together.
export function useShineSync() {
  useLayoutEffect(() => {
    if (typeof document.getAnimations !== 'function') return
    for (const a of document.getAnimations()) {
      if (a.animationName === 'goal-shine' && a.startTime !== 0) a.startTime = 0
    }
  })
}
