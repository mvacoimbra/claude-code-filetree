// Nouns other mods add to `$`, as this mod calls them. Not part of this mod's contract.
import type { KitSkin } from '../hooks/kit/tone'

declare module 'claude-code' {
  interface EngineInterface {
    skins: { palette: () => Promise<KitSkin> }
  }
}
