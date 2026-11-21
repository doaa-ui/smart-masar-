import crypto from 'node:crypto';
import { db, generateId, logAudit } from './db.ts';
import type {
  OrgApprovalStatus,
  OrgPositionStatus,
  OrgSheetDbSyncPreview,
  OrgSyncChangeItem,
  SheetDbJobReference,
} from '../src/types/org.ts';

const DEFAULT_SHEETDB_URL = 'https://sheetdb.io/api/v1/t6gn6706e48iu';

// Deterministic department reconciliation map: SheetDB ID -> existing SQLite org_departments.id
const SHEETDB_DEPT_TO_LOCAL: Record<string, string> = {
  exec: 'dept-exec',
  'dept-exec-digital-advisory': 'dept-digital-advisory',
  'dept-inst-dev': 'dept-training',
  'dept-hr': 'dept-hr',
  'dept-marketing': 'dept-marketing',
  'dept-finance': 'dept-finance',
  'dept-tech-ai': 'dept-tech-ai',
  'dept-ops-projects': 'dept-ops-projects',
  'dept-biz-dev': 'dept-biz-dev',
  'dept-cx': 'dept-cx',
  'dept-quality': 'dept-quality-perf',
  'dept-governance-compliance': 'dept-governance',
};

// Deterministic leadership position reconciliation map: SheetDB departmentId -> existing SQLite org_positions.id
// Only matches equivalent Level 1 / Level 2 leadership roles so Level 3/4/5 portal roles are preserved intact.
const SHEETDB_TEAM_DEPT_TO_EXISTING_POS: Record<string, { localId: string; levelNumber: number }> = {
  exec: { localId: 'pos-ceo', levelNumber: 1 },
  'dept-exec-digital-advisory': { localId: 'pos-dta-advisor', levelNumber: 2 },
  'dept-hr': { localId: 'pos-hr-director', levelNumber: 2 },
  'dept-finance': { localId: 'pos-fin-head', levelNumber: 2 },
  'dept-tech-ai': { localId: 'pos-tai-director', levelNumber: 2 },
  'dept-governance-compliance': { localId: 'pos-gov-lead', levelNumber: 2 },
};

const NEW_HEAD_POSITION_META: Record<string, { id: string; code: string }> = {
  'dept-inst-dev': { id: 'pos-idt-head', code: 'POS-IDT-001' },
  'dept-marketing': { id: 'pos-mpr-head', code: 'POS-MPR-001' },
  'dept-ops-projects': { id: 'pos-ops-head', code: 'POS-OPS-000' },
  'dept-biz-dev': { id: 'pos-bdp-head', code: 'POS-BDP-001' },
  'dept-cx': { id: 'pos-cxs-head', code: 'POS-CXS-001' },
  'dept-quality': { id: 'pos-qpm-head', code: 'POS-QPM-000' },
};

interface RawSheetDept {
  id?: string;
  nameAr?: string;
  nameEn?: string;
}

interface RawSheetTeamRow {
  id?: string;
  jobTitleAr?: string;
  jobTitleEn?: string;
  departmentId?: string;
  managerId?: string;
  isConfirmedPosition?: string | boolean;
  order?: string | number;
  // PII fields intentionally omitted from structural mapping types
}

interface RawSheetJobRow {
  id?: string;
  titleAr?: string;
  titleEn?: string;
  departmentId?: string;
  departmentNameAr?: string;
  status?: string;
  employmentTypeAr?: string;
  locationAr?: string;
  experienceLevelAr?: string;
  postedDate?: string;
}

function hashTeamExternalId(rawTeamId: string): string {
  const digest = crypto.createHash('sha256').update(`smart-masar-team:${rawTeamId}`).digest('hex').slice(0, 12);
  return `sdb-team-${digest}`;
}

export function getValidatedSheetDbUrl(): { configured: boolean; valid: boolean; baseUrl: string; error?: string } {
  const raw = (process.env.SHEETDB_API_URL || DEFAULT_SHEETDB_URL).trim();
  if (!raw) {
    return { configured: false, valid: false, baseUrl: '', error: 'SHEETDB_API_URL is empty.' };
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || (parsed.hostname !== 'sheetdb.io' && !parsed.hostname.endsWith('.sheetdb.io'))) {
      return {
        configured: true,
        valid: false,
        baseUrl: '',
        error: 'Configured SHEETDB_API_URL rejected by HTTPS sheetdb.io allowlist.',
      };
    }
    return { configured: true, valid: true, baseUrl: `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}` };
  } catch {
    return { configured: true, valid: false, baseUrl: '', error: 'Invalid SHEETDB_API_URL syntax.' };
  }
}

export async function fetchSheetDbTabs(): Promise<{
  departments: RawSheetDept[];
  teamStructural: Array<{
    external_key: string;
    raw_id_in_memory: string;
    raw_manager_in_memory: string;
    job_title_en: string;
    job_title_ar: string;
    department_ext_id: string;
    is_confirmed: boolean;
    sort_order: number;
  }>;
  jobsReference: SheetDbJobReference[];
}> {
  const cfg = getValidatedSheetDbUrl();
  if (!cfg.valid) {
    throw new Error(cfg.error || 'SheetDB URL not configured');
  }

  const fetchTab = async <T>(sheetName?: string): Promise<T[]> => {
    const url = sheetName ? `${cfg.baseUrl}?sheet=${encodeURIComponent(sheetName)}` : cfg.baseUrl;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      throw new Error(`SheetDB HTTP ${resp.status} for ${sheetName || 'default'} tab`);
    }
    const data = await resp.json();
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected non-array SheetDB payload for ${sheetName || 'default'} tab`);
    }
    return data as T[];
  };

  const [rawDepts, rawTeam, rawJobs] = await Promise.all([
    fetchTab<RawSheetDept>('Departments'),
    fetchTab<RawSheetTeamRow>('Team'),
    fetchTab<RawSheetJobRow>('Jobs'),
  ]);

  // Strict PII stripping: discard nameAr, nameEn, email, avatarUrl, image_url, image_file_id, bioAr, initials
  const teamStructural = rawTeam
    .filter((r) => Boolean(r.id && (r.jobTitleEn || r.jobTitleAr) && r.departmentId))
    .map((r, idx) => {
      const rawId = String(r.id).trim();
      const confirmed = String(r.isConfirmedPosition ?? '').toLowerCase() === 'true';
      return {
        external_key: hashTeamExternalId(rawId),
        raw_id_in_memory: rawId,
        raw_manager_in_memory: String(r.managerId || '').trim(),
        job_title_en: String(r.jobTitleEn || '').trim(),
        job_title_ar: String(r.jobTitleAr || '').trim(),
        department_ext_id: String(r.departmentId || '').trim(),
        is_confirmed: confirmed,
        sort_order: Number(r.order || idx + 1),
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);

  const jobsReference: SheetDbJobReference[] = rawJobs.map((j) => ({
    id: String(j.id || ''),
    title: String(j.titleEn || ''),
    title_ar: String(j.titleAr || ''),
    department_id: String(j.departmentId || ''),
    department_name_ar: String(j.departmentNameAr || ''),
    status: String(j.status || ''),
    employment_type_ar: String(j.employmentTypeAr || ''),
    location_ar: String(j.locationAr || ''),
    experience_level_ar: String(j.experienceLevelAr || ''),
    posted_date: String(j.postedDate || ''),
  }));

  return {
    departments: rawDepts.filter((d) => Boolean(d.id && (d.nameEn || d.nameAr))),
    teamStructural,
    jobsReference,
  };
}

interface PlannedDeptOp {
  action: 'create' | 'update' | 'unchanged';
  local_id: string;
  code: string;
  external_id: string;
  name: string;
  name_ar: string;
  parent_department_id: string | null;
  approval_status: OrgApprovalStatus;
  sort_order: number;
  previous_approval?: string;
  field_changes: string[];
}

interface PlannedPosOp {
  action: 'create' | 'update' | 'unchanged';
  local_id: string;
  code: string;
  external_id: string;
  department_id: string;
  level_id: string;
  level_number: number;
  title: string;
  title_ar: string;
  position_status: OrgPositionStatus;
  approval_status: OrgApprovalStatus;
  occupied_count: number;
  reports_to_position_id: string | null;
  sort_order: number;
  previous_status?: string;
  previous_approval?: string;
  field_changes: string[];
}

async function computeReconciliationPlan() {
  const { departments: sheetDepts, teamStructural, jobsReference } = await fetchSheetDbTabs();

  const existingDepts = db.prepare('SELECT * FROM org_departments').all() as Array<Record<string, unknown>>;
  const existingPos = db.prepare('SELECT * FROM org_positions').all() as Array<Record<string, unknown>>;

  const deptById = new Map<string, Record<string, unknown>>();
  const deptByExt = new Map<string, Record<string, unknown>>();
  for (const d of existingDepts) {
    deptById.set(String(d.id), d);
    if (d.external_source === 'sheetdb' && d.external_id) {
      deptByExt.set(String(d.external_id), d);
    }
  }

  const posById = new Map<string, Record<string, unknown>>();
  const posByExt = new Map<string, Record<string, unknown>>();
  for (const p of existingPos) {
    posById.set(String(p.id), p);
    if (p.external_source === 'sheetdb' && p.external_id) {
      posByExt.set(String(p.external_id), p);
    }
  }

  // 1. Plan Departments Reconciliation
  const deptOps: PlannedDeptOp[] = [];
  const resolvedSheetDeptToLocal = new Map<string, string>();
  const touchedDeptIds = new Set<string>();

  sheetDepts.forEach((sd, idx) => {
    const extId = String(sd.id).trim();
    const sheetNameEn = String(sd.nameEn || '').trim();
    const sheetNameAr = String(sd.nameAr || '').trim();

    const matchedRow =
      deptByExt.get(extId) ||
      (SHEETDB_DEPT_TO_LOCAL[extId] ? deptById.get(SHEETDB_DEPT_TO_LOCAL[extId]) : undefined);

    if (matchedRow) {
      const localId = String(matchedRow.id);
      touchedDeptIds.add(localId);
      resolvedSheetDeptToLocal.set(extId, localId);

      const changes: string[] = [];
      if (String(matchedRow.external_id || '') !== extId) changes.push(`external_id: null -> ${extId}`);
      if (String(matchedRow.name || '') !== sheetNameEn) changes.push(`name: "${matchedRow.name}" -> "${sheetNameEn}"`);
      if (String(matchedRow.name_ar || '') !== sheetNameAr) changes.push(`name_ar updated`);
      if (String(matchedRow.approval_status) !== 'approved') {
        changes.push(`approval_status: ${matchedRow.approval_status} -> approved`);
      }

      deptOps.push({
        action: changes.length > 0 ? 'update' : 'unchanged',
        local_id: localId,
        code: String(matchedRow.code),
        external_id: extId,
        name: sheetNameEn,
        name_ar: sheetNameAr,
        parent_department_id: matchedRow.parent_department_id ? String(matchedRow.parent_department_id) : null,
        approval_status: 'approved',
        sort_order: Number(matchedRow.sort_order || idx + 1),
        previous_approval: String(matchedRow.approval_status),
        field_changes: changes,
      });
    } else {
      const newLocalId = extId.startsWith('dept-') ? extId : `dept-${extId}`;
      const newCode = `DEP-${extId.replace(/^dept-/, '').toUpperCase().slice(0, 6)}`;
      resolvedSheetDeptToLocal.set(extId, newLocalId);
      deptOps.push({
        action: 'create',
        local_id: newLocalId,
        code: newCode,
        external_id: extId,
        name: sheetNameEn,
        name_ar: sheetNameAr,
        parent_department_id: 'dept-exec',
        approval_status: 'approved',
        sort_order: existingDepts.length + idx + 1,
        field_changes: ['new SheetDB department'],
      });
    }
  });

  // 2. Pre-resolve Team raw_id_in_memory -> local_position_id so managerId resolves cleanly without storing PII
  const rawTeamIdToLocalPosId = new Map<string, string>();
  const plannedTargetLocalPos = new Map<string, typeof teamStructural[number]>();

  for (const row of teamStructural) {
    const mappedByExt = posByExt.get(row.external_key);
    const mappedRule = SHEETDB_TEAM_DEPT_TO_EXISTING_POS[row.department_ext_id];
    const mappedByRule = mappedRule ? posById.get(mappedRule.localId) : undefined;
    const headPreset = NEW_HEAD_POSITION_META[row.department_ext_id];

    let targetLocalId: string;
    if (mappedByExt) {
      targetLocalId = String(mappedByExt.id);
    } else if (mappedByRule) {
      targetLocalId = String(mappedByRule.id);
    } else if (headPreset && !posById.has(headPreset.id)) {
      targetLocalId = headPreset.id;
    } else if (headPreset && posById.has(headPreset.id)) {
      targetLocalId = headPreset.id;
    } else {
      targetLocalId = `pos-sdb-${row.external_key.slice(-8)}`;
    }

    rawTeamIdToLocalPosId.set(row.raw_id_in_memory, targetLocalId);
    plannedTargetLocalPos.set(targetLocalId, row);
  }

  // 3. Plan Positions Reconciliation
  const posOps: PlannedPosOp[] = [];
  const touchedPosIds = new Set<string>();

  for (const row of teamStructural) {
    const targetLocalId = rawTeamIdToLocalPosId.get(row.raw_id_in_memory)!;
    const existing = posById.get(targetLocalId);
    const localDeptId = resolvedSheetDeptToLocal.get(row.department_ext_id) || row.department_ext_id;
    const levelNumber = row.department_ext_id === 'exec' ? 1 : 2;
    const levelId = levelNumber === 1 ? 'lvl-1' : 'lvl-2';
    const nextPosStatus: OrgPositionStatus = row.is_confirmed ? 'confirmed_occupied' : 'proposed';
    const nextApproval: OrgApprovalStatus = row.is_confirmed ? 'approved' : 'proposed';
    const nextOccupiedCount = row.is_confirmed ? 1 : 0;
    const reportsToPosId = row.raw_manager_in_memory
      ? rawTeamIdToLocalPosId.get(row.raw_manager_in_memory) || null
      : null;

    if (existing) {
      touchedPosIds.add(targetLocalId);
      const changes: string[] = [];
      if (String(existing.external_id || '') !== row.external_key) {
        changes.push(`external_id: null -> ${row.external_key}`);
      }
      if (String(existing.title || '') !== row.job_title_en) {
        changes.push(`title: "${existing.title}" -> "${row.job_title_en}"`);
      }
      if (String(existing.title_ar || '') !== row.job_title_ar) {
        changes.push(`title_ar aligned with SheetDB`);
      }
      if (String(existing.position_status) !== nextPosStatus) {
        changes.push(`position_status: ${existing.position_status} -> ${nextPosStatus}`);
      }
      if (String(existing.approval_status) !== nextApproval) {
        changes.push(`approval_status: ${existing.approval_status} -> ${nextApproval}`);
      }
      if (Number(existing.occupied_count || 0) !== nextOccupiedCount) {
        changes.push(`occupied_count: ${existing.occupied_count || 0} -> ${nextOccupiedCount}`);
      }
      if (String(existing.reports_to_position_id || '') !== String(reportsToPosId || '')) {
        changes.push(`reports_to: ${existing.reports_to_position_id || 'none'} -> ${reportsToPosId || 'none'}`);
      }

      posOps.push({
        action: changes.length > 0 ? 'update' : 'unchanged',
        local_id: targetLocalId,
        code: String(existing.code),
        external_id: row.external_key,
        department_id: localDeptId,
        level_id: levelId,
        level_number: levelNumber,
        title: row.job_title_en,
        title_ar: row.job_title_ar,
        position_status: nextPosStatus,
        approval_status: nextApproval,
        occupied_count: nextOccupiedCount,
        reports_to_position_id: reportsToPosId,
        sort_order: row.sort_order,
        previous_status: String(existing.position_status),
        previous_approval: String(existing.approval_status),
        field_changes: changes,
      });
    } else {
      const headPreset = NEW_HEAD_POSITION_META[row.department_ext_id];
      const newCode = headPreset ? headPreset.code : `POS-SDB-${String(row.sort_order).padStart(3, '0')}`;
      posOps.push({
        action: 'create',
        local_id: targetLocalId,
        code: newCode,
        external_id: row.external_key,
        department_id: localDeptId,
        level_id: levelId,
        level_number: levelNumber,
        title: row.job_title_en,
        title_ar: row.job_title_ar,
        position_status: nextPosStatus,
        approval_status: nextApproval,
        occupied_count: nextOccupiedCount,
        reports_to_position_id: reportsToPosId,
        sort_order: row.sort_order,
        field_changes: ['new confirmed SheetDB leadership position (PII stripped)'],
      });
    }
  }

  // Preserved local-only records (not in SheetDB)
  const preservedDepts: OrgSyncChangeItem[] = existingDepts
    .filter((d) => !touchedDeptIds.has(String(d.id)))
    .map((d) => ({
      entity_type: 'department',
      action: 'preserve',
      local_id: String(d.id),
      code: String(d.code),
      external_key: 'portal-sqlite-only',
      label: String(d.name),
      label_ar: String(d.name_ar || ''),
      previous_approval: String(d.approval_status),
      next_approval: String(d.approval_status),
      field_changes: ['Preserved untouched in SQLite (not present in SheetDB)'],
    }));

  const preservedPositions: OrgSyncChangeItem[] = existingPos
    .filter((p) => !touchedPosIds.has(String(p.id)))
    .map((p) => ({
      entity_type: 'position',
      action: 'preserve',
      local_id: String(p.id),
      code: String(p.code),
      external_key: 'portal-sqlite-only',
      label: String(p.title),
      label_ar: String(p.title_ar || ''),
      department_id: String(p.department_id),
      previous_status: String(p.position_status),
      next_status: String(p.position_status),
      previous_approval: String(p.approval_status),
      next_approval: String(p.approval_status),
      field_changes: ['Preserved untouched in SQLite (specialist/team-lead/MEAL position)'],
    }));

  // 4. Identify Structural Conflicts & Observations
  const conflicts: OrgSheetDbSyncPreview['conflicts'] = [];

  if (posById.has('pos-ops-lead') && !touchedPosIds.has('pos-ops-lead')) {
    conflicts.push({
      id: 'ops-head-vs-team-lead',
      severity: 'info',
      description:
        'Operations & Projects (dept-ops-projects) currently has Level 3 "Operations & Assessment Projects Team Lead" (pos-ops-lead). SheetDB adds Level 2 "Head of Operations & Projects" (POS-OPS-000).',
      description_ar:
        'يحتوي قسم العمليات والمشاريع حالياً على "قائد وحدة العمليات ومشاريع التقييم" بالمستوى 3 (pos-ops-lead). سيضيف SheetDB منصب "رئيسة قسم العمليات والمشاريع" بالمستوى 2 دون المساس بالمنصب القائم.',
      resolution: 'Both roles are kept cleanly: new Level 2 Department Head created, existing Level 3 Team Lead & Level 5 Coordinator preserved.',
      resolution_ar: 'يتم الاحتفاظ بالمنصبين معاً: إنشاء رئيس القسم بالمستوى 2 والإبقاء على قائد الوحدة والمنسق دون استبدال.',
    });
  }

  if (posById.has('pos-qp-specialist') && !touchedPosIds.has('pos-qp-specialist')) {
    conflicts.push({
      id: 'quality-head-vs-analyst',
      severity: 'info',
      description:
        'Quality & Performance (dept-quality-perf) has Level 4 "Quality & Performance Analyst" (pos-qp-specialist). SheetDB adds Level 2 "Head of Quality & Performance" (POS-QPM-000).',
      description_ar:
        'يحتوي قسم الجودة والأداء على "محلل الجودة والأداء" بالمستوى 4. سيضيف SheetDB منصب "رئيسة قسم الجودة والأداء" بالمستوى 2 بشكل متكامل.',
      resolution: 'Existing Level 4 analyst role preserved untouched alongside new Level 2 Head.',
      resolution_ar: 'يُحفظ دور المحلل بالمستوى 4 كما هو مع إضافة منصب رئيس القسم بالمستوى 2.',
    });
  }

  if (jobsReference.length > 0) {
    conflicts.push({
      id: 'sheetdb-jobs-external-only',
      severity: 'info',
      description: `SheetDB Jobs tab contains ${jobsReference.length} external job postings (${jobsReference.map((j) => j.id).join(', ')}).`,
      description_ar: `يحتوي تبويب Jobs في SheetDB على ${jobsReference.length} وظائف خارجية (${jobsReference.map((j) => j.id).join('، ')}).`,
      resolution: 'Kept strictly as external read-only references in Integration Monitor; NOT imported into recruitment jobs or org_positions.',
      resolution_ar: 'تبقى كمرجع خارجي للقراءة فقط في مراقب التكامل ولن يتم استيرادها لقاعدة التوظيف أو تحويلها تلقائياً لمناصب.',
    });
  }

  const departmentChanges: OrgSyncChangeItem[] = [
    ...deptOps.map((op) => ({
      entity_type: 'department' as const,
      action: op.action,
      local_id: op.local_id,
      code: op.code,
      external_key: op.external_id,
      label: op.name,
      label_ar: op.name_ar,
      previous_approval: op.previous_approval,
      next_approval: op.approval_status,
      field_changes: op.field_changes,
    })),
    ...preservedDepts,
  ];

  const positionChanges: OrgSyncChangeItem[] = [
    ...posOps.map((op) => ({
      entity_type: 'position' as const,
      action: op.action,
      local_id: op.local_id,
      code: op.code,
      external_key: op.external_id,
      label: op.title,
      label_ar: op.title_ar,
      department_id: op.department_id,
      previous_status: op.previous_status,
      next_status: op.position_status,
      previous_approval: op.previous_approval,
      next_approval: op.approval_status,
      field_changes: op.field_changes,
    })),
    ...preservedPositions,
  ];

  const preview: OrgSheetDbSyncPreview = {
    generated_at: new Date().toISOString(),
    sheetdb_reachable: true,
    pii_stripped: true,
    summary: {
      departments_create: deptOps.filter((d) => d.action === 'create').length,
      departments_update: deptOps.filter((d) => d.action === 'update').length,
      departments_unchanged: deptOps.filter((d) => d.action === 'unchanged').length,
      departments_preserved: preservedDepts.length,
      positions_create: posOps.filter((p) => p.action === 'create').length,
      positions_update: posOps.filter((p) => p.action === 'update').length,
      positions_unchanged: posOps.filter((p) => p.action === 'unchanged').length,
      positions_preserved: preservedPositions.length,
      conflicts_count: conflicts.length,
    },
    department_changes: departmentChanges,
    position_changes: positionChanges,
    conflicts,
    external_jobs_reference: jobsReference,
  };

  return { preview, deptOps, posOps };
}

export async function buildSheetDbReconciliationPreview(): Promise<OrgSheetDbSyncPreview> {
  const { preview } = await computeReconciliationPlan();
  return preview;
}

export async function applySheetDbReconciliationSync(actor: {
  userId: string;
  userRole: string;
}): Promise<OrgSheetDbSyncPreview> {
  const { preview, deptOps, posOps } = await computeReconciliationPlan();
  const now = new Date().toISOString();

  const runSync = db.transaction(() => {
    // 1. Upsert Departments idempotently (preserving description, mapped_portal_department, parent_department_id)
    for (const d of deptOps) {
      if (d.action === 'create') {
        db.prepare(
          `INSERT INTO org_departments (
            id, code, name, name_ar, parent_department_id, description, description_ar,
            mapped_portal_department, approval_status, status, sort_order, external_source, external_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, '', '', '', ?, 'active', ?, 'sheetdb', ?, ?, ?)`
        ).run(d.local_id, d.code, d.name, d.name_ar, d.parent_department_id, d.approval_status, d.sort_order, d.external_id, now, now);
      } else if (d.action === 'update') {
        db.prepare(
          `UPDATE org_departments SET
            name = ?, name_ar = ?, approval_status = ?, external_source = 'sheetdb', external_id = ?, updated_at = ?
           WHERE id = ?`
        ).run(d.name, d.name_ar, d.approval_status, d.external_id, now, d.local_id);
      }
    }

    // 2. Upsert Positions first without FK reports_to if parent may be created in same batch, then link reports_to
    for (const p of posOps) {
      if (p.action === 'create') {
        db.prepare(
          `INSERT INTO org_positions (
            id, code, department_id, level_id, level_number, title, title_ar,
            position_status, approval_status, linked_job_id, occupied_count,
            main_objective, main_objective_ar, key_tasks_json, responsibilities_json,
            scope_of_authority, functional_permissions_json, decision_boundaries,
            required_reports_json, kpis_json, expected_deliverables_json,
            reports_to_position_id, sort_order, external_source, external_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '', '', '[]', '[]', '', '[]', '', '[]', '[]', '[]', NULL, ?, 'sheetdb', ?, ?, ?)`
        ).run(
          p.local_id,
          p.code,
          p.department_id,
          p.level_id,
          p.level_number,
          p.title,
          p.title_ar,
          p.position_status,
          p.approval_status,
          p.occupied_count,
          p.sort_order,
          p.external_id,
          now,
          now
        );
      } else if (p.action === 'update') {
        db.prepare(
          `UPDATE org_positions SET
            department_id = ?, level_id = ?, level_number = ?, title = ?, title_ar = ?,
            position_status = ?, approval_status = ?, occupied_count = ?, sort_order = ?,
            external_source = 'sheetdb', external_id = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          p.department_id,
          p.level_id,
          p.level_number,
          p.title,
          p.title_ar,
          p.position_status,
          p.approval_status,
          p.occupied_count,
          p.sort_order,
          p.external_id,
          now,
          p.local_id
        );
      }
    }

    // 3. Apply parent reporting links & keep vertical reporting edges consistent
    for (const p of posOps) {
      if (p.action === 'create' || p.action === 'update') {
        db.prepare(`UPDATE org_positions SET reports_to_position_id = ?, updated_at = ? WHERE id = ?`).run(
          p.reports_to_position_id,
          now,
          p.local_id
        );
        db.prepare(
          `DELETE FROM org_relationships WHERE relationship_type = 'reporting' AND target_type = 'position' AND target_id = ?`
        ).run(p.local_id);
        if (p.reports_to_position_id) {
          db.prepare(
            `INSERT INTO org_relationships (
              id, relationship_type, source_type, source_id, target_type, target_id,
              label, label_ar, notes, approval_status, created_at, updated_at
            ) VALUES (?, 'reporting', 'position', ?, 'position', ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            generateId('rel'),
            p.reports_to_position_id,
            p.local_id,
            'Direct Administrative Reporting',
            'تبعية إدارية مباشرة',
            'Reconciled from SheetDB structural reporting hierarchy (PII stripped).',
            p.approval_status,
            now,
            now
          );
        }
      }
    }

    logAudit({
      userId: actor.userId,
      userName: actor.userId,
      userRole: actor.userRole,
      action: 'ORG_SYNC_SHEETDB',
      entityType: 'org_structure',
      entityId: 'sheetdb-reconciliation',
      details: `Executed idempotent SheetDB structural sync: depts(create=${preview.summary.departments_create}, update=${preview.summary.departments_update}), pos(create=${preview.summary.positions_create}, update=${preview.summary.positions_update}). PII stripped; recruitment tables untouched.`,
    });
  });

  runSync();
  return preview;
}
