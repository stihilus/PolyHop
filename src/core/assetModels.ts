// Models that ship as files: every `assets/models/*.json` is a model (the same JSON a project keeps for its
// models) and is part of every new project, like the props and the building kit. Drop another file in that
// folder and rebuild to add one. `tools/make-demo.py` makes the ones of the demo project.

/** The raw JSON of the model files (they are made valid by `normalizeModel` where they are used). */
export function rawAssetModels(): unknown[] {
  const found = import.meta.glob('/assets/models/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  return Object.keys(found)
    .sort()
    .map((path) => found[path]);
}
