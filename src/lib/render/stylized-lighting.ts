export interface StylizedLightIntensityInput {
  ambientIntensity: number
  diffuseIntensity: number
  lightAmbient: number | null
  lightKey: number | null
  lightFill: number | null
}

/** Effective intensity precedence shared by every stylized shader surface. */
export function resolveStylizedLightIntensities(input: StylizedLightIntensityInput) {
  return {
    ambient: (input.lightAmbient ?? input.ambientIntensity)
      + (input.lightFill === null ? 0 : input.lightFill * .18),
    diffuse: input.lightKey ?? input.diffuseIntensity,
  }
}
