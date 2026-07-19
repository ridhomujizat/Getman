import { Check, Layers3 } from 'lucide-react';
import { useEnvironmentStore } from '../../store/environmentStore';
import { KeyValueEditor } from '../request/KeyValueEditor';
import type { ToastMessage } from '../Toast';

export function EnvironmentEditor({ onToast }: { onToast: (message: ToastMessage) => void }) {
  const file = useEnvironmentStore((state) => state.file);
  const selectedEnvironmentId = useEnvironmentStore((state) => state.selectedEnvironmentId);
  const setActive = useEnvironmentStore((state) => state.setActive);
  const setVariables = useEnvironmentStore((state) => state.setVariables);
  const selected = file.environments.find((environment) => environment.id === selectedEnvironmentId);
  const isActive = selected?.id === file.activeEnvironmentId;
  const variableCount = selected?.variables.filter((variable) => variable.key.trim() || variable.value.trim()).length ?? 0;

  const activate = async () => {
    if (!selected) return;
    try {
      await setActive(selected.id);
      onToast({ title: `${selected.name} is now active` });
    } catch (error) {
      onToast({ title: 'Could not activate environment', detail: String(error), tone: 'error' });
    }
  };

  return (
    <section className="environment-workspace">
      <div className="open-tabs">
        <div className="open-tab active environment-open-tab"><Layers3 size={13} /><span className="open-tab-name">Environment</span></div>
      </div>
      <div className="environment-header">
        <div>
          <span className="label-caps">Environment</span>
          <h1>{selected?.name ?? 'No environment selected'}</h1>
        </div>
        {selected && (isActive ? <span className="environment-status"><i /> Active</span> : <button className="environment-activate" onClick={() => void activate()}><Check size={12} /> Set active</button>)}
      </div>
      <div className="tabs environment-tabs"><button className="tab active">Variables<span className="count"> · {variableCount}</span></button></div>
      <div className="pane-body environment-pane">
        {selected ? <KeyValueEditor rows={selected.variables} onChange={(variables) => void setVariables(selected.id, variables)} /> : <div className="environment-empty"><Layers3 size={22} /><strong>Select an environment</strong><span>Choose one from the sidebar to edit its variables.</span></div>}
      </div>
    </section>
  );
}
