import type { WorkspaceRecord } from '../../types';

export type McpCapability = 'deny' | 'read' | 'draft' | 'execute';

export interface McpClient {
  id: string;
  kind: string;
  displayName: string;
  configPath: string | null;
  enabled: boolean;
  capability: McpCapability;
  installedAt: number | null;
  lastSeenAt: number | null;
}

export interface ClientOverview {
  kind: string;
  displayName: string;
  detected: boolean;
  installationStatus: string;
  configurationStatus: string;
  configPath: string | null;
  client: McpClient | null;
}

export interface McpOverview {
  enabled: boolean;
  readOnly: boolean;
  brokerAvailable: boolean;
  endpoint: string;
  clients: ClientOverview[];
  activeSessions: number;
  safety: McpSafetySettings;
}

export interface McpSafetySettings {
  storeBodyPreviews: boolean;
  sensitiveKeyPatterns: string[];
  trustedDestinations: string[];
  activityRetentionDays: number;
  activityMaxRows: number;
}

export interface McpPolicy {
  id: string;
  clientId: string | null;
  workspaceId: string | null;
  collectionId: string | null;
  environmentId: string | null;
  capability: McpCapability;
  environmentClass: string | null;
  environmentUse: boolean | null;
  approvalMode: 'always' | 'risky' | 'policy' | null;
  createdAt: number;
  updatedAt: number;
}

export type PolicyInput = Omit<McpPolicy, 'id' | 'createdAt' | 'updatedAt'> & { id?: string | null };

export interface McpActivity {
  id: string;
  sessionId: string;
  clientId: string;
  clientName: string;
  toolName: string;
  workspaceId: string | null;
  collectionId: string | null;
  requestId: string | null;
  draftId: string | null;
  status: string;
  policyReasons: string[];
  inputSummary: unknown;
  outputSummary: unknown;
  errorCode: string | null;
  errorDetail: string | null;
  approvalId: string | null;
  approvalDecision: string | null;
  approvalRequestedAt: number | null;
  approvalDecidedAt: number | null;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
}

export interface ActivityQuery {
  search?: string;
  clientId?: string;
  toolName?: string;
  workspaceId?: string;
  status?: string;
  approvalDecision?: string;
  sessionId?: string;
  startedAfter?: number;
  startedBefore?: number;
  offset?: number;
  limit?: number;
}

export interface McpApproval {
  id: string;
  activityId: string;
  workspaceId: string | null;
  clientName: string;
  toolName: string;
  requestFingerprint: string;
  riskReasons: string[];
  summary: Record<string, unknown>;
  decision: string;
  requestedAt: number;
  decidedAt: number | null;
  expiresAt: number;
}

export interface McpDraftForUi { id: string; workspaceId: string; revision: number; request: import('../../types').TesApiRequest }

export interface ConfigPreview {
  kind: string;
  displayName: string;
  targetPath: string;
  operation: string;
  command: string;
  args: string[];
  snippet: string;
  preservesExisting: boolean;
  backupRequired: boolean;
}

export interface CollectionOption { id: string; name: string; requestCount: number; folderCount: number }
export interface EnvironmentOption { id: string; name: string; variableCount: number; secretCount: number }

export interface McpWorkspaceProps {
  currentWorkspace: WorkspaceRecord;
  workspaces: WorkspaceRecord[];
  onToast: (message: { title: string; detail?: string; tone?: 'success' | 'error' }) => void;
  embedded?: boolean;
}
