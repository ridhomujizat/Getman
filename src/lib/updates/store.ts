import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import { getSetting, setSetting } from '../registry';
import { shouldAutoCheck } from './schedule';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'failed';

export interface ReleaseInfo {
  version: string;
  date?: string;
  notes?: string;
}

interface UpdateState {
  initialized: boolean;
  installedVersion: string;
  autoCheck: boolean;
  lastCheckedAt: number | null;
  status: UpdateStatus;
  release: ReleaseInfo | null;
  downloadedBytes: number;
  contentLength: number | null;
  error: string | null;
  promptVisible: boolean;
  updatedVersion: string | null;
  initialize: () => Promise<void>;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  dismissPrompt: () => void;
  showPrompt: () => void;
}

let activeUpdate: Update | null = null;

const message = (error: unknown) => String(error).replace(/^Error:\s*/, '');

export const useUpdateStore = create<UpdateState>((set, get) => ({
  initialized: false,
  installedVersion: '',
  autoCheck: true,
  lastCheckedAt: null,
  status: 'idle',
  release: null,
  downloadedBytes: 0,
  contentLength: null,
  error: null,
  promptVisible: false,
  updatedVersion: null,

  initialize: async () => {
    if (get().initialized) return;
    const [installedVersion, autoCheck, lastCheckedAt, pendingVersion] = await Promise.all([
      getVersion(),
      getSetting<boolean>('updates.autoCheck'),
      getSetting<number>('updates.lastCheckedAt'),
      getSetting<string>('updates.pendingVersion'),
    ]);
    const updatedVersion = pendingVersion === installedVersion ? pendingVersion : null;
    if (pendingVersion) await setSetting('updates.pendingVersion', null);
    set({ initialized: true, installedVersion, autoCheck: autoCheck !== false, lastCheckedAt, updatedVersion });
  },

  checkForUpdates: async (manual = false) => {
    const state = get();
    if (['checking', 'downloading', 'installing'].includes(state.status)) return;
    if (!manual && (!state.autoCheck || !shouldAutoCheck(state.lastCheckedAt))) return;
    if (import.meta.env.DEV) {
      if (manual) set({ status: 'failed', error: 'Update checks are available in an installed TesAPI build.' });
      return;
    }
    set({ status: 'checking', error: null });
    const checkedAt = Date.now();
    try {
      if (activeUpdate) await activeUpdate.close();
      activeUpdate = await check({ timeout: 15_000 });
      if (!activeUpdate) {
        set({ status: 'idle', release: null, promptVisible: false, lastCheckedAt: checkedAt });
        await Promise.all([setSetting('updates.lastResult', 'current'), setSetting('updates.lastCheckedAt', checkedAt)]);
        return;
      }
      const release = { version: activeUpdate.version, date: activeUpdate.date, notes: activeUpdate.body };
      set({ status: 'available', release, promptVisible: true, lastCheckedAt: checkedAt });
      await Promise.all([setSetting('updates.lastResult', 'available'), setSetting('updates.lastCheckedAt', checkedAt)]);
    } catch (error) {
      activeUpdate = null;
      const detail = message(error);
      set({ status: 'failed', error: detail, release: null, promptVisible: false, lastCheckedAt: checkedAt });
      await Promise.all([setSetting('updates.lastResult', 'failed'), setSetting('updates.lastCheckedAt', checkedAt)]).catch(() => undefined);
    }
  },

  setAutoCheck: async (enabled) => {
    set({ autoCheck: enabled });
    await setSetting('updates.autoCheck', enabled);
  },

  download: async () => {
    if (!activeUpdate || get().status === 'downloading') return;
    let downloadedBytes = 0;
    set({ status: 'downloading', downloadedBytes: 0, contentLength: null, error: null });
    try {
      await activeUpdate.download((event: DownloadEvent) => {
        if (event.event === 'Started') set({ contentLength: event.data.contentLength ?? null });
        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          set({ downloadedBytes });
        }
        if (event.event === 'Finished') set({ status: 'ready' });
      });
      set({ status: 'ready' });
    } catch (error) {
      set({ status: 'failed', error: message(error) });
    }
  },

  install: async () => {
    if (!activeUpdate || get().status !== 'ready') return;
    set({ status: 'installing', error: null });
    try {
      await setSetting('updates.pendingVersion', activeUpdate.version);
      await activeUpdate.install();
      await relaunch();
    } catch (error) {
      await setSetting('updates.pendingVersion', null).catch(() => undefined);
      set({ status: 'failed', error: message(error) });
    }
  },

  dismissPrompt: () => set({ promptVisible: false }),
  showPrompt: () => set({ promptVisible: true }),
}));
