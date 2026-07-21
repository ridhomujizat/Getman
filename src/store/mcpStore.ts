import { create } from 'zustand';
import { getMcpOverview, listMcpActivity, listMcpApprovals, listMcpPolicies } from '../lib/mcp/client';
import type { ActivityQuery, McpActivity, McpApproval, McpOverview, McpPolicy } from '../lib/mcp/types';

interface State {
  overview: McpOverview | null;
  policies: McpPolicy[];
  activity: McpActivity[];
  approvals: McpApproval[];
  busy: boolean;
  loadError: string | null;
  loadOverview: () => Promise<void>;
  loadPolicies: () => Promise<void>;
  loadActivity: (query?: ActivityQuery) => Promise<void>;
  loadApprovals: (workspaceId?: string) => Promise<void>;
  refresh: (workspaceId?: string) => Promise<void>;
}

export const useMcpStore = create<State>((set) => ({
  overview: null,
  policies: [],
  activity: [],
  approvals: [],
  busy: false,
  loadError: null,
  loadOverview: async () => {
    try { set({ overview: await getMcpOverview(), loadError: null }); }
    catch (error) { set({ loadError: String(error) }); }
  },
  loadPolicies: async () => {
    try { set({ policies: await listMcpPolicies(), loadError: null }); }
    catch (error) { set({ loadError: String(error) }); }
  },
  loadActivity: async (query = {}) => {
    try { set({ activity: await listMcpActivity(query), loadError: null }); }
    catch (error) { set({ loadError: String(error) }); }
  },
  loadApprovals: async (workspaceId) => {
    try { set({ approvals: await listMcpApprovals(workspaceId), loadError: null }); }
    catch (error) { set({ loadError: String(error) }); }
  },
  refresh: async (workspaceId) => {
    set({ busy: true });
    try {
      const [overview, policies, activity, approvals] = await Promise.all([getMcpOverview(), listMcpPolicies(), listMcpActivity({ limit: 500 }), listMcpApprovals(workspaceId)]);
      set({ overview, policies, activity, approvals, loadError: null });
    } catch (error) { set({ loadError: String(error) }); }
    finally { set({ busy: false }); }
  },
}));
