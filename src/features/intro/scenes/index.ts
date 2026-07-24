import type { IntroScene, IntroSceneId } from './types'
import { lightsOut } from './lightsOut'
import { pitWall } from './pitWall'
import { harness } from './harness'
import { slipstream } from './slipstream'

/**
 * As quatro variantes em avaliação. Depois da escolha, as descartadas somem
 * daqui e do disco — o contrato IntroScene existe pra isso ser uma deleção de
 * arquivo, não uma cirurgia.
 */
export const INTRO_SCENES: IntroScene[] = [lightsOut, pitWall, harness, slipstream]

/** A que roda no boot enquanto a escolha não foi feita. */
export const DEFAULT_INTRO_SCENE: IntroSceneId = 'lights-out'

export function getIntroScene(id: IntroSceneId): IntroScene {
  return INTRO_SCENES.find((s) => s.id === id) ?? INTRO_SCENES[0]
}
