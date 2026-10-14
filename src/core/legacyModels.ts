// Fingerprints (see modelHash.ts) of the built-in models that are still built in (the pickups, the Slime and the
// Villager) as they were before they were redrawn in the style of the Hytale modeling guide (version 14). A saved
// project whose copy still has one of these is replaced by the new model when it is opened; a copy that the user
// changed is left alone.

export const LEGACY_MODEL_HASHES: Record<string, string> = {
  'item-apple': 'fcea82e1',
  'item-coin': 'e0db2bb3',
  'item-flag': '871cf1c5',
  'item-key': '1b3c15ba',
  'item-trophy': 'b8e116e7',
  'prop-slime': '07d9f52a',
  'prop-villager': '744fd3da',
};
