/**
 * Database types. Hand-authored to mirror supabase/migrations/*.sql.
 * If you later run `supabase gen types typescript`, replace this file wholesale.
 *
 * Kept intentionally close to the generated shape so swapping is painless:
 * Database['public']['Tables'][T]['Row' | 'Insert' | 'Update'].
 */

import type { GenerationParams, MessageMetrics, Role } from '@/types';

type Timestamptz = string;
type Json = Record<string, unknown> | Json[] | string | number | boolean | null;

interface Table<Row, Insert, Update> {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
}

/** Common helper: optional-on-insert columns that have DB defaults. */
type WithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type WorkspaceRow = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  is_default: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type ConversationRow = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  model: string;
  system_prompt: string;
  params: GenerationParams | Record<string, never>;
  /** Added in 0005. jsonb — validated in mappers.ts, not trusted. */
  thinking: unknown;
  /** Added in 0005. jsonb — the running compaction summary, or null. */
  summary: unknown;
  folder: string | null;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  parent_id: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type MessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: Role;
  content: string;
  model: string | null;
  metrics: MessageMetrics | null;
  error: string | null;
  /** Added in 0005. The model's extended-thinking output. */
  reasoning: string | null;
  /** Added in 0005. jsonb — search sources/context, effort, etc. */
  metadata: unknown;
  parent_id: string | null;
  seq: number;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type AttachmentRow = {
  id: string;
  user_id: string;
  message_id: string | null;
  conversation_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  bucket: string;
  storage_path: string;
  extracted_text: string | null;
  created_at: Timestamptz;
}

export type ArtifactRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  kind: string;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  bucket: string;
  storage_path: string;
  version: number;
  metadata: Json;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type DownloadRow = {
  id: string;
  user_id: string;
  artifact_id: string | null;
  name: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  progress: number;
  size_bytes: number;
  bucket: string | null;
  storage_path: string | null;
  error: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type DocumentRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  name: string;
  doc_type: string;
  current_version: number;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type DocumentVersionRow = {
  id: string;
  document_id: string;
  user_id: string;
  version: number;
  bucket: string;
  storage_path: string;
  size_bytes: number;
  note: string | null;
  created_at: Timestamptz;
}

export type SavedPromptRow = {
  id: string;
  user_id: string;
  name: string;
  content: string;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type InstalledModelRow = {
  id: string;
  user_id: string;
  name: string;
  family: string | null;
  parameter_size: string | null;
  quantization: string | null;
  size_bytes: number | null;
  context_length: number | null;
  supports_vision: boolean;
  raw: Json;
  updated_at: Timestamptz;
}

export type WorkspaceSettingsRow = {
  workspace_id: string;
  user_id: string;
  settings: Json;
  updated_at: Timestamptz;
}

export type UserPreferencesRow = {
  user_id: string;
  preferences: Json;
  updated_at: Timestamptz;
}

export type ActivityLogRow = {
  id: string;
  user_id: string;
  action: string;
  target: string | null;
  metadata: Json;
  created_at: Timestamptz;
}

/** Owner-curated display names for models. Publicly readable; owner-only writes. */
export type ModelLabelRow = {
  model_name: string;
  display_name: string;
  description: string | null;
  hidden: boolean;
  sort_order: number;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        WithDefaults<ProfileRow, 'is_guest' | 'created_at' | 'updated_at' | 'email' | 'display_name' | 'avatar_url'>,
        Partial<ProfileRow>
      >;
      workspaces: Table<
        WorkspaceRow,
        WithDefaults<WorkspaceRow, 'id' | 'name' | 'icon' | 'is_default' | 'created_at' | 'updated_at'>,
        Partial<WorkspaceRow>
      >;
      conversations: Table<
        ConversationRow,
        WithDefaults<
          ConversationRow,
          'id' | 'workspace_id' | 'title' | 'model' | 'system_prompt' | 'params' | 'folder'
          | 'thinking' | 'summary'
          | 'pinned' | 'favorite' | 'archived' | 'parent_id' | 'created_at' | 'updated_at'
        >,
        Partial<ConversationRow>
      >;
      messages: Table<
        MessageRow,
        WithDefaults<
          MessageRow,
          'id' | 'content' | 'model' | 'metrics' | 'error' | 'reasoning' | 'metadata'
          | 'parent_id' | 'seq' | 'created_at' | 'updated_at'
        >,
        Partial<MessageRow>
      >;
      attachments: Table<
        AttachmentRow,
        WithDefaults<AttachmentRow, 'id' | 'message_id' | 'conversation_id' | 'size_bytes' | 'bucket' | 'extracted_text' | 'created_at'>,
        Partial<AttachmentRow>
      >;
      artifacts: Table<
        ArtifactRow,
        WithDefaults<ArtifactRow, 'id' | 'conversation_id' | 'message_id' | 'mime_type' | 'size_bytes' | 'bucket' | 'version' | 'metadata' | 'created_at' | 'updated_at'>,
        Partial<ArtifactRow>
      >;
      downloads: Table<
        DownloadRow,
        WithDefaults<DownloadRow, 'id' | 'artifact_id' | 'status' | 'progress' | 'size_bytes' | 'bucket' | 'storage_path' | 'error' | 'created_at' | 'updated_at'>,
        Partial<DownloadRow>
      >;
      documents: Table<
        DocumentRow,
        WithDefaults<DocumentRow, 'id' | 'conversation_id' | 'current_version' | 'created_at' | 'updated_at'>,
        Partial<DocumentRow>
      >;
      document_versions: Table<
        DocumentVersionRow,
        WithDefaults<DocumentVersionRow, 'id' | 'bucket' | 'size_bytes' | 'note' | 'created_at'>,
        Partial<DocumentVersionRow>
      >;
      saved_prompts: Table<
        SavedPromptRow,
        WithDefaults<SavedPromptRow, 'id' | 'created_at' | 'updated_at'>,
        Partial<SavedPromptRow>
      >;
      installed_models: Table<
        InstalledModelRow,
        WithDefaults<InstalledModelRow, 'id' | 'family' | 'parameter_size' | 'quantization' | 'size_bytes' | 'context_length' | 'supports_vision' | 'raw' | 'updated_at'>,
        Partial<InstalledModelRow>
      >;
      workspace_settings: Table<
        WorkspaceSettingsRow,
        WithDefaults<WorkspaceSettingsRow, 'settings' | 'updated_at'>,
        Partial<WorkspaceSettingsRow>
      >;
      user_preferences: Table<
        UserPreferencesRow,
        WithDefaults<UserPreferencesRow, 'preferences' | 'updated_at'>,
        Partial<UserPreferencesRow>
      >;
      activity_logs: Table<
        ActivityLogRow,
        WithDefaults<ActivityLogRow, 'id' | 'target' | 'metadata' | 'created_at'>,
        Partial<ActivityLogRow>
      >;
      model_labels: Table<
        ModelLabelRow,
        WithDefaults<ModelLabelRow, 'description' | 'hidden' | 'sort_order' | 'created_at' | 'updated_at'>,
        Partial<ModelLabelRow>
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
