import { useEffect, useState } from 'react';
import { SCENARIO_MAP } from '../../data/scenarios';
import { loadSlot, quitToMenu, saveToSlot } from '../../app/game';
import { store, useApp } from '../../app/store';
import { deleteSlot, exportSlot, importText, listSlots, type SlotInfo } from '../../save/storage';
import { formatDate } from '../../sim/calendar';

const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];

export function SavesPanel({ inMenu = false }: { inMenu?: boolean }) {
  const world = useApp((s) => s.world);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => listSlots().then(setSlots);
  useEffect(() => {
    refresh();
  }, []);
  const info = (slot: string) => slots.find((s) => s.slot === slot);
  const save = async (slot: string) => {
    const ex = info(slot);
    const doIt = async () => {
      setBusy(true);
      await saveToSlot(slot);
      await refresh();
      setBusy(false);
      store.set({ confirm: null });
    };
    if (ex && ex.ok) store.askConfirm({ title: `Overwrite ${slot}?`, body: `"${ex.name}" will be replaced (the old copy is kept as a backup).`, confirmLabel: 'Overwrite', danger: true, onConfirm: doIt });
    else doIt();
  };
  const del = (slot: string) =>
    store.askConfirm({
      title: `Delete ${slot}?`,
      body: 'The save and its backup will be removed permanently.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await deleteSlot(slot);
        await refresh();
        store.set({ confirm: null });
      },
    });
  const doExport = async (slot: string) => {
    const text = await exportSlot(slot);
    if (!text) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `nationforge-${slot}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        await importText('imported', await f.text());
        await refresh();
        store.toast('Save imported to slot "imported"');
      } catch (e) {
        store.toast(`Import failed: ${(e as Error).message}`, 'err');
      }
    };
    inp.click();
  };
  const all = [...new Set([...(world ? SLOTS : []), ...slots.map((s) => s.slot)])];
  return (
    <div className="col" style={{ gap: 10 }}>
      {world && (
        <div className="row">
          <button className="btn" onClick={() => store.set({ panel: 'settings' })}>Settings</button>
          <button className="btn" onClick={() => store.set({ panel: 'help' })}>Help</button>
          <span className="spacer" />
          <button className="btn danger" onClick={() => store.askConfirm({ title: 'Quit to the main menu?', body: 'Unsaved progress since the last save will be lost.', confirmLabel: 'Quit', danger: true, onConfirm: () => (store.set({ confirm: null }), quitToMenu()) })}>Quit to menu</button>
        </div>
      )}
      <h3>{inMenu ? 'Load a saved nation' : 'Save & load'}</h3>
      <table className="t small">
        <thead>
          <tr><th>Slot</th><th>Nation</th><th>Date</th><th className="r">Pop.</th><th /></tr>
        </thead>
        <tbody>
          {all.map((slot) => {
            const s = info(slot);
            return (
              <tr key={slot}>
                <td>{slot}{s?.backup ? <span className="dim tiny"> +backup</span> : null}</td>
                <td>{s ? (s.ok ? <>{s.nation}<div className="tiny dim">{SCENARIO_MAP[s.scenario]?.name}</div></> : <span className="bad">damaged: {s.error}</span>) : <span className="dim">empty</span>}</td>
                <td>{s?.ok ? <>{formatDate(s.day, 2031)}<div className="tiny dim">{new Date(s.savedAt).toLocaleString()}</div></> : ''}</td>
                <td className="r">{s?.ok ? s.pop.toLocaleString() : ''}</td>
                <td className="r">
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                    {world && slot !== 'autosave' && <button className="btn sm" disabled={busy} onClick={() => save(slot)}>Save</button>}
                    {s && (s.ok || s.backup) && <button className="btn sm" onClick={() => loadSlot(slot)}>{s.ok ? 'Load' : 'Recover'}</button>}
                    {s && <button className="btn sm" onClick={() => doExport(slot)} title="Download as a file">⬇</button>}
                    {s && <button className="btn sm danger" onClick={() => del(slot)}>✕</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <button className="btn sm" onClick={doImport}>Import save file…</button>
        <span className="spacer" />
        <span className="tiny muted">Saves live in this browser (IndexedDB). Each slot keeps a backup of the previous save for recovery.</span>
      </div>
    </div>
  );
}
