// Autosave at month boundaries, every N months (Settings.autosaveMonths).

import { saveGame } from '../save/storage';
import type { World } from '../sim/world';
import { store } from './store';

let busy = false;

export function autosaveIfDue(world: World) {
  const months = store.get().settings.autosaveMonths;
  if (!months || busy) return;
  const st = world.state;
  if (st.day - st.lastAutosaveDay < months * 30 - 2) return;
  st.lastAutosaveDay = st.day;
  busy = true;
  saveGame('autosave', st, `Autosave – ${st.nation.name}`)
    .then(() => store.toast('Autosaved'))
    .catch((e) => store.toast(`Autosave failed: ${(e as Error).message}`, 'err'))
    .finally(() => (busy = false));
}
