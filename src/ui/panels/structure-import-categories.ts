/**
 * Import categories are isolated from React components to preserve Fast Refresh.
 * They classify one-shot structure sources by data model and periodicity; persistent
 * local folders belong to Assets instead.
 */

export type StructureImportCategory = "materials" | "molecules" | "macromolecules"

export const STRUCTURE_IMPORT_CATEGORIES = [
  { value: "materials", label: "Materials" },
  { value: "molecules", label: "Molecules" },
  { value: "macromolecules", label: "Macromolecules" },
] as const
