// Keep native environment and reaction data aligned with the Web definitions.
import { writeFileSync } from 'node:fs';
import { GARDEN } from '../shared/worlds.ts';
import { EMOTES } from '../shared/emotes.ts';
writeFileSync(new URL('Tonarium.Unity/Assets/Resources/Web/WorldCatalog.json', import.meta.url), JSON.stringify({ garden: GARDEN, emotes: EMOTES }, null, 2) + '\n');
