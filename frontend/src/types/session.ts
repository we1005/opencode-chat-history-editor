export enum SessionStatus {
  RUNNING = 'running',
  IDLE = 'idle',
  COMPLETED = 'completed',
  ARCHIVED = 'archived'
}

export interface Session {
  id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  version: string;
  share_url: string | null;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
  summary_diffs: string | null;
  revert: string | null;
  permission: string | null;
  time_created: number;
  time_updated: number;
  time_compacting: number | null;
  time_archived: number | null;
  workspace_id: string | null;
  message_count?: number;
  subagent_type?: string;
  children?: SessionTreeNode[];
  status?: SessionStatus;
}

export interface SessionTreeNode extends Session {
  children: SessionTreeNode[];
  message_count: number;
}

export interface Message {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
  parts?: Part[];
}

export interface Part {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export type EditablePart = Record<string, unknown> & {
  id: string;
  messageID: string;
  sessionID: string;
  type: string;
  text?: string;
};

export interface PartSnapshot { part: EditablePart; revision: string }
export interface PartBackup { id: string; createdAt: string; part: EditablePart }

export interface MessageContent {
  role: 'user' | 'assistant' | 'system';
  agent?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  parentID?: string;
  mode?: string;
  path?: {
    cwd: string;
    root: string;
  };
  cost?: number;
  tokens?: {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cache: {
      write: number;
      read: number;
    };
  };
  time?: {
    created: number;
    completed?: number;
  };
  finish?: string;
  content?: string;
  summary?: {
    diffs: unknown[];
  };
}

export interface DiffFile {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: string;
  after?: string;
}

export interface SessionStats {
  messageCount: number;
  partCount: number;
  childCount: number;
}
