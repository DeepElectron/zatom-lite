export type InspectorTab = 'functions' | 'visual'
export type InspectorWorkspace = InspectorTab | 'animation'

/** Animation temporarily owns the Inspector without mutating its selected tab. */
export function resolveInspectorWorkspace(
  animationOpen: boolean,
  selectedTab: InspectorTab,
): InspectorWorkspace {
  return animationOpen ? 'animation' : selectedTab
}
