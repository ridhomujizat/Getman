import { create } from 'zustand';
import type { EnvironmentsFile, KeyValue } from '../types';
import { emptyRow, withTrailingBlank } from '../lib/params';
import { uid } from '../lib/id';
import { copyEnvironment, removeEnvironment } from '../lib/environments';
import { storageProvider } from '../lib/storage/localJson';

interface State {
  file: EnvironmentsFile;
  selectedEnvironmentId: string | null;
  initialize: () => Promise<void>;
  createEnvironment: (name: string, initial?: { key: string; value: string }, activate?: boolean) => Promise<string>;
  duplicateEnvironment: (id: string) => Promise<string>;
  renameEnvironment: (id: string, name: string) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  selectEnvironment: (id: string | null) => void;
  setActive: (id: string | null) => Promise<void>;
  setVariables: (id: string, variables: KeyValue[]) => Promise<void>;
  setVariable: (id: string, key: string, value: string) => Promise<void>;
}

const empty: EnvironmentsFile = { schemaVersion: 1, activeEnvironmentId: null, environments: [] };
let saveTimer = 0;

function saveSoon(file: EnvironmentsFile): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void storageProvider.saveEnvironments(file).catch((error) => console.error('Could not save environments', error));
  }, 500);
}

export const useEnvironmentStore = create<State>((set, get) => ({
  file: empty,
  selectedEnvironmentId: null,
  initialize: async () => {
    const file = await storageProvider.loadEnvironments();
    set({ file, selectedEnvironmentId: file.activeEnvironmentId });
  },
  createEnvironment: async (name, initial, activate = true) => {
    const environment = {
      id: uid(),
      name: name.trim() || 'Environment',
      variables: initial?.key ? [{ ...emptyRow(), key: initial.key, value: initial.value, enabled: true }, emptyRow()] : [emptyRow()],
    };
    const file = { ...get().file, activeEnvironmentId: activate ? environment.id : get().file.activeEnvironmentId, environments: [...get().file.environments, environment] };
    await storageProvider.saveEnvironments(file);
    window.clearTimeout(saveTimer);
    set({ file, selectedEnvironmentId: environment.id });
    return environment.id;
  },
  duplicateEnvironment: async (id) => {
    const source = get().file.environments.find((environment) => environment.id === id);
    if (!source) throw new Error('Environment not found');
    const duplicate = copyEnvironment(source);
    const index = get().file.environments.findIndex((environment) => environment.id === id);
    const environments = [...get().file.environments];
    environments.splice(index + 1, 0, duplicate);
    const file = { ...get().file, environments };
    await storageProvider.saveEnvironments(file);
    window.clearTimeout(saveTimer);
    set({ file, selectedEnvironmentId: duplicate.id });
    return duplicate.id;
  },
  renameEnvironment: async (id, name) => {
    const file = { ...get().file, environments: get().file.environments.map((environment) => environment.id === id ? { ...environment, name: name.trim() || 'Environment' } : environment) };
    await storageProvider.saveEnvironments(file);
    window.clearTimeout(saveTimer);
    set({ file });
  },
  deleteEnvironment: async (id) => {
    const file = removeEnvironment(get().file, id);
    await storageProvider.saveEnvironments(file);
    window.clearTimeout(saveTimer);
    const selectedEnvironmentId = get().selectedEnvironmentId === id ? file.activeEnvironmentId : get().selectedEnvironmentId;
    set({ file, selectedEnvironmentId });
  },
  selectEnvironment: (selectedEnvironmentId) => set({ selectedEnvironmentId }),
  setActive: async (activeEnvironmentId) => {
    if (get().file.activeEnvironmentId === activeEnvironmentId) return;
    const file = { ...get().file, activeEnvironmentId };
    await storageProvider.saveEnvironments(file);
    window.clearTimeout(saveTimer);
    set({ file });
  },
  setVariables: async (id, variables) => {
    const file = { ...get().file, environments: get().file.environments.map((environment) => environment.id === id ? { ...environment, variables: withTrailingBlank(variables) } : environment) };
    set({ file });
    saveSoon(file);
  },
  setVariable: async (id, key, value) => {
    const file = {
      ...get().file,
      environments: get().file.environments.map((environment) => {
        if (environment.id !== id) return environment;
        const existing = environment.variables.find((item) => item.key.trim() === key.trim());
        const variables = existing
          ? environment.variables.map((item) => item.id === existing.id ? { ...item, key: key.trim(), value, enabled: true } : item)
          : [...environment.variables.filter((item) => item.key || item.value || item.valueType === 'file'), { ...emptyRow(), key: key.trim(), value, enabled: true }, emptyRow()];
        return { ...environment, variables };
      }),
    };
    set({ file });
    saveSoon(file);
  },
}));

export const activeVariables = () => {
  const { file } = useEnvironmentStore.getState();
  return file.environments.find((environment) => environment.id === file.activeEnvironmentId)?.variables ?? [];
};
