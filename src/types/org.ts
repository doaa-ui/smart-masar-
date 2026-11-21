export type OrgApprovalStatus = 'approved' | 'proposed' | 'under_review' | 'archived';

export type OrgPositionStatus =
  | 'confirmed_occupied'
  | 'approved_vacant'
  | 'proposed'
  | 'inactive';

export type OrgRelationshipType =
  | 'reporting'
  | 'collaboration'
  | 'advisory'
  | 'matrix';

export type OrgSystemRoleKey =
  | 'super_admin'
  | 'org_admin'
  | 'hr_admin'
  | 'department_manager'
  | 'content_editor'
  | 'internal_viewer'
  | 'public_visitor';

export type OrgPermissionKey =
  | 'can_view'
  | 'can_create'
  | 'can_edit'
  | 'can_delete'
  | 'can_archive'
  | 'can_review'
  | 'can_approve'
  | 'can_publish';

export interface OrgLevel {
  id: string;
  level_number: number;
  code: string;
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  sort_order: number;
}

export interface OrgDepartment {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  parent_department_id: string | null;
  description: string;
  description_ar: string;
  mapped_portal_department: string;
  approval_status: OrgApprovalStatus;
  status: 'active' | 'archived';
  sort_order: number;
  external_source?: string | null;
  external_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgPosition {
  id: string;
  code: string;
  department_id: string;
  level_id: string;
  level_number: number;
  title: string;
  title_ar: string;
  position_status: OrgPositionStatus;
  approval_status: OrgApprovalStatus;
  linked_job_id: string | null;
  linked_job_title?: string | null;
  linked_job_status?: string | null;
  occupied_count: number;
  main_objective: string;
  main_objective_ar: string;
  key_tasks: string[];
  responsibilities: string[];
  scope_of_authority: string;
  functional_permissions: string[];
  decision_boundaries: string;
  required_reports: string[];
  kpis: string[];
  expected_deliverables: string[];
  reports_to_position_id: string | null;
  sort_order: number;
  external_source?: string | null;
  external_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgRelationship {
  id: string;
  relationship_type: OrgRelationshipType;
  source_type: 'department' | 'position';
  source_id: string;
  target_type: 'department' | 'position';
  target_id: string;
  label: string;
  label_ar: string;
  notes: string;
  approval_status: OrgApprovalStatus;
  created_at: string;
  updated_at: string;
}

export type RaciLetter = 'R' | 'A' | 'C' | 'I' | '';

export interface OrgRaciEntry {
  id: string;
  process_name: string;
  process_name_ar: string;
  department_id: string | null;
  owner_position_id: string | null;
  assignments: Record<string, RaciLetter>;
  approval_status: OrgApprovalStatus;
  notes: string;
  updated_at: string;
}

export interface OrgRolePermission {
  role_key: OrgSystemRoleKey;
  role_name: string;
  role_name_ar: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_archive: boolean;
  can_review: boolean;
  can_approve: boolean;
  can_publish: boolean;
}

export interface OrgUserRoleMapping {
  user_id: string;
  portal_role: 'admin' | 'assessor' | 'candidate';
  portal_department: string;
  org_role_key: OrgSystemRoleKey;
}

export interface OrgConsistencyIssue {
  id: string;
  severity: 'info' | 'warning';
  source: string;
  title: string;
  title_ar: string;
  details: string;
  details_ar: string;
}

export interface SheetDbJobReference {
  id: string;
  title: string;
  title_ar: string;
  department_id: string;
  department_name_ar: string;
  status: string;
  employment_type_ar: string;
  location_ar: string;
  experience_level_ar: string;
  posted_date: string;
}

export interface OrgSyncChangeItem {
  entity_type: 'department' | 'position';
  action: 'create' | 'update' | 'preserve' | 'unchanged';
  local_id: string;
  code: string;
  external_key: string;
  label: string;
  label_ar: string;
  department_id?: string;
  previous_status?: string;
  next_status?: string;
  previous_approval?: string;
  next_approval?: string;
  field_changes: string[];
}

export interface OrgSheetDbSyncPreview {
  generated_at: string;
  sheetdb_reachable: boolean;
  pii_stripped: boolean;
  summary: {
    departments_create: number;
    departments_update: number;
    departments_unchanged: number;
    departments_preserved: number;
    positions_create: number;
    positions_update: number;
    positions_unchanged: number;
    positions_preserved: number;
    conflicts_count: number;
  };
  department_changes: OrgSyncChangeItem[];
  position_changes: OrgSyncChangeItem[];
  conflicts: Array<{
    id: string;
    severity: 'warning' | 'info';
    description: string;
    description_ar: string;
    resolution: string;
    resolution_ar: string;
  }>;
  external_jobs_reference: SheetDbJobReference[];
}

export interface OrgIntegrationStatus {
  database_connected: boolean;
  database_engine: string;
  persistence_mode: 'ephemeral_container_disk' | 'persistent_volume';
  persistence_warning: string;
  persistence_warning_ar: string;
  sheetdb_configured: boolean;
  sheetdb_status: 'not_configured' | 'connected' | 'error';
  sheetdb_message: string;
  sheetdb_counts?: {
    departments: number;
    team_structural_roles: number;
    jobs: number;
  };
  last_checked_at: string;
  counts: {
    departments: number;
    approved_departments: number;
    proposed_departments: number;
    positions: number;
    approved_positions: number;
    proposed_positions: number;
    relationships: number;
    raci_rows: number;
    portal_jobs: number;
    portal_staff_accounts: number;
  };
  inconsistencies: OrgConsistencyIssue[];
  portal_jobs_reference: Array<{
    id: string;
    title: string;
    title_ar: string;
    department: string;
    status: string;
    linked_position_id: string | null;
  }>;
  sheetdb_jobs_reference: SheetDbJobReference[];
}

export interface OrgWorkspacePayload {
  my_role: OrgSystemRoleKey;
  my_permissions: OrgRolePermission;
  levels: OrgLevel[];
  departments: OrgDepartment[];
  positions: OrgPosition[];
  relationships: OrgRelationship[];
  raci: OrgRaciEntry[];
  permissions_matrix: OrgRolePermission[];
}
