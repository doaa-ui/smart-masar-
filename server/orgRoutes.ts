import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import { db, generateId, logAudit } from './db.ts';
import {
  applySheetDbReconciliationSync,
  buildSheetDbReconciliationPreview,
  fetchSheetDbTabs,
  getValidatedSheetDbUrl,
} from './orgSheetDbSync.ts';
import type { User } from '../src/types/domain.ts';
import type {
  OrgApprovalStatus,
  OrgConsistencyIssue,
  OrgDepartment,
  OrgIntegrationStatus,
  OrgLevel,
  OrgPermissionKey,
  OrgPosition,
  OrgPositionStatus,
  OrgRaciEntry,
  OrgRelationship,
  OrgRelationshipType,
  OrgRolePermission,
  OrgSystemRoleKey,
  RaciLetter,
} from '../src/types/org.ts';

interface AuthRequest extends Request {
  user?: User;
  orgRole?: OrgSystemRoleKey;
  orgPerms?: OrgRolePermission;
}

const VALID_APPROVAL_STATUSES: OrgApprovalStatus[] = ['approved', 'proposed', 'under_review', 'archived'];
const VALID_POSITION_STATUSES: OrgPositionStatus[] = [
  'confirmed_occupied',
  'approved_vacant',
  'proposed',
  'inactive',
];
const VALID_REL_TYPES: OrgRelationshipType[] = ['reporting', 'collaboration', 'advisory', 'matrix'];

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function hydrateLevel(row: Record<string, unknown>): OrgLevel {
  return {
    id: String(row.id),
    level_number: Number(row.level_number),
    code: String(row.code),
    name: String(row.name),
    name_ar: String(row.name_ar || ''),
    description: String(row.description || ''),
    description_ar: String(row.description_ar || ''),
    sort_order: Number(row.sort_order || 0),
  };
}

function hydrateDepartment(row: Record<string, unknown>): OrgDepartment {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    name_ar: String(row.name_ar || ''),
    parent_department_id: row.parent_department_id ? String(row.parent_department_id) : null,
    description: String(row.description || ''),
    description_ar: String(row.description_ar || ''),
    mapped_portal_department: String(row.mapped_portal_department || ''),
    approval_status: (row.approval_status as OrgApprovalStatus) || 'proposed',
    status: (row.status as 'active' | 'archived') || 'active',
    sort_order: Number(row.sort_order || 0),
    external_source: row.external_source ? String(row.external_source) : null,
    external_id: row.external_id ? String(row.external_id) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function hydratePosition(row: Record<string, unknown>): OrgPosition {
  return {
    id: String(row.id),
    code: String(row.code),
    department_id: String(row.department_id),
    level_id: String(row.level_id),
    level_number: Number(row.level_number),
    title: String(row.title),
    title_ar: String(row.title_ar || ''),
    position_status: (row.position_status as OrgPositionStatus) || 'proposed',
    approval_status: (row.approval_status as OrgApprovalStatus) || 'proposed',
    linked_job_id: row.linked_job_id ? String(row.linked_job_id) : null,
    linked_job_title: row.linked_job_title ? String(row.linked_job_title) : null,
    linked_job_status: row.linked_job_status ? String(row.linked_job_status) : null,
    occupied_count: Number(row.occupied_count || 0),
    main_objective: String(row.main_objective || ''),
    main_objective_ar: String(row.main_objective_ar || ''),
    key_tasks: parseJson<string[]>(row.key_tasks_json, []),
    responsibilities: parseJson<string[]>(row.responsibilities_json, []),
    scope_of_authority: String(row.scope_of_authority || ''),
    functional_permissions: parseJson<string[]>(row.functional_permissions_json, []),
    decision_boundaries: String(row.decision_boundaries || ''),
    required_reports: parseJson<string[]>(row.required_reports_json, []),
    kpis: parseJson<string[]>(row.kpis_json, []),
    expected_deliverables: parseJson<string[]>(row.expected_deliverables_json, []),
    reports_to_position_id: row.reports_to_position_id ? String(row.reports_to_position_id) : null,
    sort_order: Number(row.sort_order || 0),
    external_source: row.external_source ? String(row.external_source) : null,
    external_id: row.external_id ? String(row.external_id) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function hydrateRelationship(row: Record<string, unknown>): OrgRelationship {
  return {
    id: String(row.id),
    relationship_type: row.relationship_type as OrgRelationshipType,
    source_type: row.source_type as 'department' | 'position',
    source_id: String(row.source_id),
    target_type: row.target_type as 'department' | 'position',
    target_id: String(row.target_id),
    label: String(row.label || ''),
    label_ar: String(row.label_ar || ''),
    notes: String(row.notes || ''),
    approval_status: (row.approval_status as OrgApprovalStatus) || 'proposed',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function hydrateRaci(row: Record<string, unknown>): OrgRaciEntry {
  return {
    id: String(row.id),
    process_name: String(row.process_name),
    process_name_ar: String(row.process_name_ar || ''),
    department_id: row.department_id ? String(row.department_id) : null,
    owner_position_id: row.owner_position_id ? String(row.owner_position_id) : null,
    assignments: parseJson<Record<string, RaciLetter>>(row.assignments_json, {}),
    approval_status: (row.approval_status as OrgApprovalStatus) || 'proposed',
    notes: String(row.notes || ''),
    updated_at: String(row.updated_at),
  };
}

function hydrateRolePermission(row: Record<string, unknown>): OrgRolePermission {
  return {
    role_key: row.role_key as OrgSystemRoleKey,
    role_name: String(row.role_name),
    role_name_ar: String(row.role_name_ar || ''),
    can_view: Boolean(row.can_view),
    can_create: Boolean(row.can_create),
    can_edit: Boolean(row.can_edit),
    can_delete: Boolean(row.can_delete),
    can_archive: Boolean(row.can_archive),
    can_review: Boolean(row.can_review),
    can_approve: Boolean(row.can_approve),
    can_publish: Boolean(row.can_publish),
  };
}

function resolveOrgAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Strictly block candidates and public users regardless of any role mapping
  if (user.role === 'candidate') {
    res.status(403).json({
      error: 'Forbidden: Organizational Structure module is restricted to authorized internal staff only.',
    });
    return;
  }

  const mapping = db
    .prepare('SELECT org_role_key FROM org_user_roles WHERE user_id = ?')
    .get(user.id) as { org_role_key: OrgSystemRoleKey } | undefined;

  let roleKey: OrgSystemRoleKey = mapping?.org_role_key || (user.role === 'admin' ? 'super_admin' : 'internal_viewer');
  if (roleKey === 'public_visitor') {
    res.status(403).json({ error: 'Forbidden: public visitors cannot access internal organizational structure.' });
    return;
  }

  const permRow = db
    .prepare('SELECT * FROM org_role_permissions WHERE role_key = ?')
    .get(roleKey) as Record<string, unknown> | undefined;

  if (!permRow) {
    res.status(403).json({ error: 'Forbidden: role permission profile not found.' });
    return;
  }

  const perms = hydrateRolePermission(permRow);
  if (!perms.can_view) {
    res.status(403).json({ error: 'Forbidden: your system role does not have View permission.' });
    return;
  }

  req.orgRole = roleKey;
  req.orgPerms = perms;
  next();
}

function requireOrgPerm(permKey: OrgPermissionKey) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.orgPerms || !req.orgPerms[permKey]) {
      res.status(403).json({ error: `Forbidden: missing required organizational permission (${permKey}).` });
      return;
    }
    next();
  };
}

function wouldCreatePositionCycle(childPositionId: string, proposedParentId: string | null): boolean {
  if (!proposedParentId) return false;
  if (childPositionId === proposedParentId) return true;

  const visited = new Set<string>([childPositionId]);
  let cursor: string | null = proposedParentId;
  let guard = 0;

  while (cursor && guard < 100) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    const row = db
      .prepare('SELECT reports_to_position_id FROM org_positions WHERE id = ?')
      .get(cursor) as { reports_to_position_id: string | null } | undefined;
    cursor = row?.reports_to_position_id || null;
    guard += 1;
  }
  return false;
}

function wouldCreateDeptCycle(deptId: string, proposedParentId: string | null): boolean {
  if (!proposedParentId) return false;
  if (deptId === proposedParentId) return true;

  const visited = new Set<string>([deptId]);
  let cursor: string | null = proposedParentId;
  let guard = 0;

  while (cursor && guard < 100) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    const row = db
      .prepare('SELECT parent_department_id FROM org_departments WHERE id = ?')
      .get(cursor) as { parent_department_id: string | null } | undefined;
    cursor = row?.parent_department_id || null;
    guard += 1;
  }
  return false;
}

function syncReportingEdgeForPosition(positionId: string, reportsToId: string | null, approvalStatus: OrgApprovalStatus): void {
  const now = new Date().toISOString();
  db.prepare(
    `DELETE FROM org_relationships
     WHERE relationship_type = 'reporting' AND target_type = 'position' AND target_id = ?`
  ).run(positionId);

  if (reportsToId) {
    db.prepare(
      `INSERT INTO org_relationships (
        id, relationship_type, source_type, source_id, target_type, target_id,
        label, label_ar, notes, approval_status, created_at, updated_at
      ) VALUES (?, 'reporting', 'position', ?, 'position', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateId('rel'),
      reportsToId,
      positionId,
      'Direct Administrative Reporting',
      'تبعية إدارية مباشرة',
      'Synchronized from position reporting hierarchy.',
      approvalStatus,
      now,
      now
    );
  }
}

export function createOrgRouter(
  authenticate: (req: AuthRequest, res: Response, next: NextFunction) => void
): express.Router {
  const router = express.Router();
  router.use(authenticate, resolveOrgAccess);

  // ==================== WORKSPACE FETCH ====================
  router.get('/workspace', (req: AuthRequest, res: Response) => {
    const levels = (db.prepare('SELECT * FROM org_levels ORDER BY level_number, sort_order').all() as Array<
      Record<string, unknown>
    >).map(hydrateLevel);

    const departments = (
      db.prepare('SELECT * FROM org_departments ORDER BY sort_order, name').all() as Array<Record<string, unknown>>
    ).map(hydrateDepartment);

    const positions = (
      db
        .prepare(
          `SELECT p.*, j.title as linked_job_title, j.status as linked_job_status
           FROM org_positions p
           LEFT JOIN jobs j ON j.id = p.linked_job_id
           ORDER BY p.level_number, p.sort_order, p.title`
        )
        .all() as Array<Record<string, unknown>>
    ).map(hydratePosition);

    const relationships = (
      db.prepare('SELECT * FROM org_relationships ORDER BY relationship_type, created_at').all() as Array<
        Record<string, unknown>
      >
    ).map(hydrateRelationship);

    const raci = (db.prepare('SELECT * FROM org_raci ORDER BY updated_at DESC').all() as Array<
      Record<string, unknown>
    >).map(hydrateRaci);

    const permissionsMatrix = (
      db.prepare('SELECT * FROM org_role_permissions').all() as Array<Record<string, unknown>>
    ).map(hydrateRolePermission);

    const canSeeDrafts = Boolean(
      req.orgPerms?.can_create || req.orgPerms?.can_edit || req.orgPerms?.can_review || req.orgPerms?.can_approve
    );
    const approvedOnly = !canSeeDrafts || req.query.scope === 'approved';

    const filteredDepartments = approvedOnly
      ? departments.filter((d) => d.approval_status === 'approved' && d.status === 'active')
      : departments;

    const approvedDeptIds = new Set(filteredDepartments.map((d) => d.id));
    const filteredPositions = approvedOnly
      ? positions.filter(
          (p) =>
            p.approval_status === 'approved' &&
            p.position_status !== 'inactive' &&
            approvedDeptIds.has(p.department_id)
        )
      : positions;

    const filteredRelationships = approvedOnly
      ? relationships.filter((r) => r.approval_status === 'approved')
      : relationships;

    const filteredRaci = approvedOnly ? raci.filter((r) => r.approval_status === 'approved') : raci;

    const visiblePermsMatrix = canSeeDrafts
      ? permissionsMatrix
      : permissionsMatrix.filter((r) => r.role_key === req.orgRole);

    res.json({
      my_role: req.orgRole,
      my_permissions: req.orgPerms,
      levels,
      departments: filteredDepartments,
      positions: filteredPositions,
      relationships: filteredRelationships,
      raci: filteredRaci,
      permissions_matrix: visiblePermsMatrix,
    });
  });

  // ==================== ORGANIZATIONAL LEVELS (FLEXIBLE) ====================
  router.post('/levels', requireOrgPerm('can_create'), (req: AuthRequest, res: Response) => {
    const { level_number, code, name, name_ar, description, description_ar } = req.body as {
      level_number?: number;
      code?: string;
      name?: string;
      name_ar?: string;
      description?: string;
      description_ar?: string;
    };

    const num = Number(level_number);
    if (!Number.isInteger(num) || num < 1 || num > 20 || !name?.trim()) {
      res.status(400).json({ error: 'Valid level_number (1-20) and level name are required.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM org_levels WHERE level_number = ?').get(num);
    if (exists) {
      res.status(409).json({ error: `Organizational Level ${num} already exists.` });
      return;
    }

    const id = generateId('lvl');
    db.prepare(
      `INSERT INTO org_levels (id, level_number, code, name, name_ar, description, description_ar, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      num,
      (code || `L${num}`).trim(),
      name.trim(),
      (name_ar || '').trim(),
      (description || '').trim(),
      (description_ar || '').trim(),
      num
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_CREATE_LEVEL',
      entityType: 'org_level',
      entityId: id,
      details: `Created level L${num}: ${name.trim()}`,
    });

    res.status(201).json({ id });
  });

  router.put('/levels/:id', requireOrgPerm('can_edit'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM org_levels WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Level not found' });
      return;
    }

    const { code, name, name_ar, description, description_ar, sort_order } = req.body as Partial<OrgLevel>;
    db.prepare(
      `UPDATE org_levels SET code = ?, name = ?, name_ar = ?, description = ?, description_ar = ?, sort_order = ? WHERE id = ?`
    ).run(
      code !== undefined ? String(code).trim() : String(existing.code),
      name !== undefined ? String(name).trim() : String(existing.name),
      name_ar !== undefined ? String(name_ar).trim() : String(existing.name_ar || ''),
      description !== undefined ? String(description).trim() : String(existing.description || ''),
      description_ar !== undefined ? String(description_ar).trim() : String(existing.description_ar || ''),
      sort_order !== undefined ? Number(sort_order) : Number(existing.sort_order),
      id
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_UPDATE_LEVEL',
      entityType: 'org_level',
      entityId: id,
      details: `Updated organizational level ${id}`,
    });

    res.json({ ok: true });
  });

  // ==================== DEPARTMENTS ====================
  router.post('/departments', requireOrgPerm('can_create'), (req: AuthRequest, res: Response) => {
    const {
      code,
      name,
      name_ar,
      parent_department_id,
      description,
      description_ar,
      mapped_portal_department,
      approval_status,
      sort_order,
    } = req.body as Partial<OrgDepartment>;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Department English name is required.' });
      return;
    }

    const requestedApproval: OrgApprovalStatus =
      approval_status && VALID_APPROVAL_STATUSES.includes(approval_status) ? approval_status : 'proposed';
    if (requestedApproval === 'approved' && !req.orgPerms?.can_approve) {
      res.status(403).json({ error: 'Forbidden: Approve permission required to mark department as Approved.' });
      return;
    }

    const deptCode = (code || `DEP-${Date.now().toString(36).toUpperCase().slice(-4)}`).trim();
    const dupCode = db.prepare('SELECT id FROM org_departments WHERE code = ?').get(deptCode);
    if (dupCode) {
      res.status(409).json({ error: `Department code ${deptCode} already exists.` });
      return;
    }

    if (parent_department_id) {
      const parentExists = db.prepare('SELECT id FROM org_departments WHERE id = ?').get(parent_department_id);
      if (!parentExists) {
        res.status(400).json({ error: 'Parent department does not exist.' });
        return;
      }
    }

    const id = generateId('dept');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO org_departments (
        id, code, name, name_ar, parent_department_id, description, description_ar,
        mapped_portal_department, approval_status, status, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      deptCode,
      name.trim(),
      (name_ar || '').trim(),
      parent_department_id || null,
      (description || '').trim(),
      (description_ar || '').trim(),
      (mapped_portal_department || '').trim(),
      requestedApproval,
      Number(sort_order || 99),
      now,
      now
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_CREATE_DEPARTMENT',
      entityType: 'org_department',
      entityId: id,
      details: `Created department ${deptCode} (${name.trim()}) [${requestedApproval}]`,
    });

    res.status(201).json({ id });
  });

  router.patch('/departments/:id', requireOrgPerm('can_edit'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM org_departments WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    const body = req.body as Partial<OrgDepartment>;

    if (body.approval_status !== undefined && body.approval_status !== existing.approval_status) {
      if (!VALID_APPROVAL_STATUSES.includes(body.approval_status)) {
        res.status(400).json({ error: 'Invalid approval_status' });
        return;
      }
      if (body.approval_status === 'approved' && !req.orgPerms?.can_approve) {
        res.status(403).json({ error: 'Forbidden: Approve permission required.' });
        return;
      }
    }

    if (body.status === 'archived' && existing.status !== 'archived' && !req.orgPerms?.can_archive) {
      res.status(403).json({ error: 'Forbidden: Archive permission required.' });
      return;
    }

    const nextParent =
      body.parent_department_id !== undefined
        ? body.parent_department_id
        : existing.parent_department_id
        ? String(existing.parent_department_id)
        : null;

    if (wouldCreateDeptCycle(id, nextParent)) {
      res.status(400).json({ error: 'Circular parent department hierarchy is not allowed.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE org_departments SET
        code = ?, name = ?, name_ar = ?, parent_department_id = ?, description = ?, description_ar = ?,
        mapped_portal_department = ?, approval_status = ?, status = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      body.code !== undefined ? String(body.code).trim() : String(existing.code),
      body.name !== undefined ? String(body.name).trim() : String(existing.name),
      body.name_ar !== undefined ? String(body.name_ar).trim() : String(existing.name_ar || ''),
      nextParent,
      body.description !== undefined ? String(body.description).trim() : String(existing.description || ''),
      body.description_ar !== undefined ? String(body.description_ar).trim() : String(existing.description_ar || ''),
      body.mapped_portal_department !== undefined
        ? String(body.mapped_portal_department).trim()
        : String(existing.mapped_portal_department || ''),
      body.approval_status || String(existing.approval_status),
      body.status || String(existing.status),
      body.sort_order !== undefined ? Number(body.sort_order) : Number(existing.sort_order),
      now,
      id
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_UPDATE_DEPARTMENT',
      entityType: 'org_department',
      entityId: id,
      details: `Updated department ${id} (${body.name || existing.name})`,
    });

    res.json({ ok: true });
  });

  router.delete('/departments/:id', requireOrgPerm('can_delete'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const posCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM org_positions WHERE department_id = ?').get(id) as { cnt: number }
    ).cnt;
    if (posCount > 0) {
      res.status(400).json({
        error: 'Department still contains positions. Move or remove its positions first, or archive the department instead.',
      });
      return;
    }

    db.prepare(
      `DELETE FROM org_relationships WHERE (source_type = 'department' AND source_id = ?) OR (target_type = 'department' AND target_id = ?)`
    ).run(id, id);
    const result = db.prepare('DELETE FROM org_departments WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_DELETE_DEPARTMENT',
      entityType: 'org_department',
      entityId: id,
      details: `Deleted empty department ${id}`,
    });

    res.json({ ok: true });
  });

  // ==================== POSITIONS & FULL 17-FIELD PROFILES ====================
  router.post('/positions', requireOrgPerm('can_create'), (req: AuthRequest, res: Response) => {
    const body = req.body as Partial<OrgPosition>;

    if (!body.title?.trim() || !body.department_id) {
      res.status(400).json({ error: 'Position title and department_id are required.' });
      return;
    }

    const deptExists = db.prepare('SELECT id FROM org_departments WHERE id = ?').get(body.department_id);
    if (!deptExists) {
      res.status(400).json({ error: 'Selected department does not exist.' });
      return;
    }

    const levelRow = (
      body.level_id
        ? db.prepare('SELECT * FROM org_levels WHERE id = ?').get(body.level_id)
        : db.prepare('SELECT * FROM org_levels WHERE level_number = ?').get(Number(body.level_number || 4))
    ) as Record<string, unknown> | undefined;

    if (!levelRow) {
      res.status(400).json({ error: 'Valid organizational level is required.' });
      return;
    }

    const requestedApproval: OrgApprovalStatus =
      body.approval_status && VALID_APPROVAL_STATUSES.includes(body.approval_status)
        ? body.approval_status
        : 'proposed';
    if (requestedApproval === 'approved' && !req.orgPerms?.can_approve) {
      res.status(403).json({ error: 'Forbidden: Approve permission required to create an Approved position.' });
      return;
    }

    const requestedPosStatus: OrgPositionStatus =
      body.position_status && VALID_POSITION_STATUSES.includes(body.position_status)
        ? body.position_status
        : 'proposed';

    if (requestedPosStatus !== 'proposed' && requestedApproval !== 'approved' && !req.orgPerms?.can_approve) {
      res.status(403).json({
        error: 'New positions created without Approve permission must start with Proposed status.',
      });
      return;
    }

    if (body.linked_job_id) {
      const jobRow = db.prepare('SELECT id FROM jobs WHERE id = ?').get(body.linked_job_id);
      if (!jobRow) {
        res.status(400).json({ error: 'Linked portal job not found.' });
        return;
      }
    }

    const posCode = (body.code || `POS-${Date.now().toString(36).toUpperCase().slice(-5)}`).trim();
    const dupCode = db.prepare('SELECT id FROM org_positions WHERE code = ?').get(posCode);
    if (dupCode) {
      res.status(409).json({ error: `Position code ${posCode} already exists.` });
      return;
    }

    if (body.reports_to_position_id) {
      const mgrExists = db.prepare('SELECT id FROM org_positions WHERE id = ?').get(body.reports_to_position_id);
      if (!mgrExists) {
        res.status(400).json({ error: 'Reporting manager position does not exist.' });
        return;
      }
    }

    const id = generateId('pos');
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO org_positions (
        id, code, department_id, level_id, level_number, title, title_ar,
        position_status, approval_status, linked_job_id, occupied_count,
        main_objective, main_objective_ar, key_tasks_json, responsibilities_json,
        scope_of_authority, functional_permissions_json, decision_boundaries,
        required_reports_json, kpis_json, expected_deliverables_json,
        reports_to_position_id, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      posCode,
      body.department_id,
      String(levelRow.id),
      Number(levelRow.level_number),
      body.title.trim(),
      (body.title_ar || '').trim(),
      requestedPosStatus,
      requestedApproval,
      body.linked_job_id || null,
      Math.max(0, Number(body.occupied_count || 0)),
      (body.main_objective || '').trim(),
      (body.main_objective_ar || '').trim(),
      JSON.stringify(normalizeStringArray(body.key_tasks)),
      JSON.stringify(normalizeStringArray(body.responsibilities)),
      (body.scope_of_authority || '').trim(),
      JSON.stringify(normalizeStringArray(body.functional_permissions)),
      (body.decision_boundaries || '').trim(),
      JSON.stringify(normalizeStringArray(body.required_reports)),
      JSON.stringify(normalizeStringArray(body.kpis)),
      JSON.stringify(normalizeStringArray(body.expected_deliverables)),
      body.reports_to_position_id || null,
      Number(body.sort_order || 50),
      now,
      now
    );

    if (body.reports_to_position_id) {
      syncReportingEdgeForPosition(id, body.reports_to_position_id, requestedApproval);
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_CREATE_POSITION',
      entityType: 'org_position',
      entityId: id,
      details: `Created position ${posCode} (${body.title.trim()}) in ${body.department_id} [${requestedApproval}]`,
    });

    res.status(201).json({ id });
  });

  router.patch('/positions/:id', requireOrgPerm('can_edit'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Position not found' });
      return;
    }

    const body = req.body as Partial<OrgPosition>;

    if (body.approval_status !== undefined && body.approval_status !== existing.approval_status) {
      if (!VALID_APPROVAL_STATUSES.includes(body.approval_status)) {
        res.status(400).json({ error: 'Invalid approval_status' });
        return;
      }
      if (body.approval_status === 'approved' && !req.orgPerms?.can_approve) {
        res.status(403).json({ error: 'Forbidden: Approve permission required.' });
        return;
      }
    }

    if (body.position_status !== undefined && !VALID_POSITION_STATUSES.includes(body.position_status)) {
      res.status(400).json({ error: 'Invalid position_status' });
      return;
    }

    const nextDeptId = body.department_id || String(existing.department_id);
    if (!db.prepare('SELECT id FROM org_departments WHERE id = ?').get(nextDeptId)) {
      res.status(400).json({ error: 'Target department does not exist.' });
      return;
    }

    let nextLevelId = String(existing.level_id);
    let nextLevelNumber = Number(existing.level_number);
    if (body.level_id || body.level_number !== undefined) {
      const lvl = (
        body.level_id
          ? db.prepare('SELECT * FROM org_levels WHERE id = ?').get(body.level_id)
          : db.prepare('SELECT * FROM org_levels WHERE level_number = ?').get(Number(body.level_number))
      ) as Record<string, unknown> | undefined;
      if (!lvl) {
        res.status(400).json({ error: 'Selected organizational level does not exist.' });
        return;
      }
      nextLevelId = String(lvl.id);
      nextLevelNumber = Number(lvl.level_number);
    }

    const nextReportsTo =
      body.reports_to_position_id !== undefined
        ? body.reports_to_position_id || null
        : existing.reports_to_position_id
        ? String(existing.reports_to_position_id)
        : null;

    if (nextReportsTo) {
      const mgr = db.prepare('SELECT id FROM org_positions WHERE id = ?').get(nextReportsTo);
      if (!mgr) {
        res.status(400).json({ error: 'Reporting manager position does not exist.' });
        return;
      }
      if (wouldCreatePositionCycle(id, nextReportsTo)) {
        res.status(400).json({ error: 'Circular reporting hierarchy detected and rejected.' });
        return;
      }
    }

    const nextApproval = (body.approval_status || existing.approval_status) as OrgApprovalStatus;
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE org_positions SET
        code = ?, department_id = ?, level_id = ?, level_number = ?, title = ?, title_ar = ?,
        position_status = ?, approval_status = ?, linked_job_id = ?, occupied_count = ?,
        main_objective = ?, main_objective_ar = ?, key_tasks_json = ?, responsibilities_json = ?,
        scope_of_authority = ?, functional_permissions_json = ?, decision_boundaries = ?,
        required_reports_json = ?, kpis_json = ?, expected_deliverables_json = ?,
        reports_to_position_id = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      body.code !== undefined ? String(body.code).trim() : String(existing.code),
      nextDeptId,
      nextLevelId,
      nextLevelNumber,
      body.title !== undefined ? String(body.title).trim() : String(existing.title),
      body.title_ar !== undefined ? String(body.title_ar).trim() : String(existing.title_ar || ''),
      body.position_status || String(existing.position_status),
      nextApproval,
      body.linked_job_id !== undefined ? body.linked_job_id || null : existing.linked_job_id,
      body.occupied_count !== undefined ? Math.max(0, Number(body.occupied_count)) : Number(existing.occupied_count || 0),
      body.main_objective !== undefined ? String(body.main_objective).trim() : String(existing.main_objective || ''),
      body.main_objective_ar !== undefined
        ? String(body.main_objective_ar).trim()
        : String(existing.main_objective_ar || ''),
      body.key_tasks !== undefined ? JSON.stringify(normalizeStringArray(body.key_tasks)) : String(existing.key_tasks_json),
      body.responsibilities !== undefined
        ? JSON.stringify(normalizeStringArray(body.responsibilities))
        : String(existing.responsibilities_json),
      body.scope_of_authority !== undefined
        ? String(body.scope_of_authority).trim()
        : String(existing.scope_of_authority || ''),
      body.functional_permissions !== undefined
        ? JSON.stringify(normalizeStringArray(body.functional_permissions))
        : String(existing.functional_permissions_json),
      body.decision_boundaries !== undefined
        ? String(body.decision_boundaries).trim()
        : String(existing.decision_boundaries || ''),
      body.required_reports !== undefined
        ? JSON.stringify(normalizeStringArray(body.required_reports))
        : String(existing.required_reports_json),
      body.kpis !== undefined ? JSON.stringify(normalizeStringArray(body.kpis)) : String(existing.kpis_json),
      body.expected_deliverables !== undefined
        ? JSON.stringify(normalizeStringArray(body.expected_deliverables))
        : String(existing.expected_deliverables_json),
      nextReportsTo,
      body.sort_order !== undefined ? Number(body.sort_order) : Number(existing.sort_order),
      now,
      id
    );

    if (body.reports_to_position_id !== undefined) {
      syncReportingEdgeForPosition(id, nextReportsTo, nextApproval);
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_UPDATE_POSITION',
      entityType: 'org_position',
      entityId: id,
      details: `Updated position ${id} (dept=${nextDeptId}, level=L${nextLevelNumber}, status=${body.position_status || existing.position_status})`,
    });

    res.json({ ok: true });
  });

  router.delete('/positions/:id', requireOrgPerm('can_delete'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    db.prepare('UPDATE org_positions SET reports_to_position_id = NULL WHERE reports_to_position_id = ?').run(id);
    db.prepare(
      `DELETE FROM org_relationships WHERE (source_type = 'position' AND source_id = ?) OR (target_type = 'position' AND target_id = ?)`
    ).run(id, id);
    const result = db.prepare('DELETE FROM org_positions WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Position not found' });
      return;
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_DELETE_POSITION',
      entityType: 'org_position',
      entityId: id,
      details: `Deleted position ${id}`,
    });

    res.json({ ok: true });
  });

  // ==================== RELATIONSHIPS ====================
  router.post('/relationships', requireOrgPerm('can_create'), (req: AuthRequest, res: Response) => {
    const body = req.body as Partial<OrgRelationship>;
    if (!body.relationship_type || !VALID_REL_TYPES.includes(body.relationship_type)) {
      res.status(400).json({ error: 'Valid relationship_type is required.' });
      return;
    }
    if (!body.source_id || !body.target_id || !body.source_type || !body.target_type) {
      res.status(400).json({ error: 'source_type, source_id, target_type, and target_id are required.' });
      return;
    }
    if (body.source_type === body.target_type && body.source_id === body.target_id) {
      res.status(400).json({ error: 'Self-referential relationship is not allowed.' });
      return;
    }

    const requestedApproval: OrgApprovalStatus =
      body.approval_status && VALID_APPROVAL_STATUSES.includes(body.approval_status)
        ? body.approval_status
        : 'proposed';
    if (requestedApproval === 'approved' && !req.orgPerms?.can_approve) {
      res.status(403).json({ error: 'Forbidden: Approve permission required.' });
      return;
    }

    // Verify endpoints exist
    const srcTable = body.source_type === 'department' ? 'org_departments' : 'org_positions';
    const tgtTable = body.target_type === 'department' ? 'org_departments' : 'org_positions';
    if (!db.prepare(`SELECT id FROM ${srcTable} WHERE id = ?`).get(body.source_id)) {
      res.status(400).json({ error: 'Source entity does not exist.' });
      return;
    }
    if (!db.prepare(`SELECT id FROM ${tgtTable} WHERE id = ?`).get(body.target_id)) {
      res.status(400).json({ error: 'Target entity does not exist.' });
      return;
    }

    if (
      body.relationship_type === 'reporting' &&
      body.source_type === 'position' &&
      body.target_type === 'position'
    ) {
      if (wouldCreatePositionCycle(body.target_id, body.source_id)) {
        res.status(400).json({ error: 'Circular vertical reporting relationship detected and rejected.' });
        return;
      }
      db.prepare('UPDATE org_positions SET reports_to_position_id = ?, updated_at = ? WHERE id = ?').run(
        body.source_id,
        new Date().toISOString(),
        body.target_id
      );
      db.prepare(
        `DELETE FROM org_relationships WHERE relationship_type = 'reporting' AND target_type = 'position' AND target_id = ?`
      ).run(body.target_id);
    }

    const id = generateId('rel');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO org_relationships (
        id, relationship_type, source_type, source_id, target_type, target_id,
        label, label_ar, notes, approval_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.relationship_type,
      body.source_type,
      body.source_id,
      body.target_type,
      body.target_id,
      (body.label || '').trim(),
      (body.label_ar || '').trim(),
      (body.notes || '').trim(),
      requestedApproval,
      now,
      now
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_CREATE_RELATIONSHIP',
      entityType: 'org_relationship',
      entityId: id,
      details: `Added ${body.relationship_type} relationship ${body.source_id} -> ${body.target_id}`,
    });

    res.status(201).json({ id });
  });

  router.patch('/relationships/:id', requireOrgPerm('can_edit'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM org_relationships WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Relationship not found' });
      return;
    }

    const body = req.body as Partial<OrgRelationship>;
    if (body.approval_status !== undefined && body.approval_status !== existing.approval_status) {
      if (!VALID_APPROVAL_STATUSES.includes(body.approval_status)) {
        res.status(400).json({ error: 'Invalid approval_status' });
        return;
      }
      if (body.approval_status === 'approved' && !req.orgPerms?.can_approve) {
        res.status(403).json({ error: 'Forbidden: Approve permission required.' });
        return;
      }
    }

    const nextType = body.relationship_type || (existing.relationship_type as OrgRelationshipType);
    const nextNotes = body.notes !== undefined ? String(body.notes).trim() : String(existing.notes || '');
    const nextLabel = body.label !== undefined ? String(body.label).trim() : String(existing.label || '');
    const nextLabelAr = body.label_ar !== undefined ? String(body.label_ar).trim() : String(existing.label_ar || '');
    const nextApproval = body.approval_status || (existing.approval_status as OrgApprovalStatus);
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE org_relationships SET relationship_type = ?, label = ?, label_ar = ?, notes = ?, approval_status = ?, updated_at = ? WHERE id = ?`
    ).run(nextType, nextLabel, nextLabelAr, nextNotes, nextApproval, now, id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_UPDATE_RELATIONSHIP',
      entityType: 'org_relationship',
      entityId: id,
      details: `Updated relationship ${id} (${nextApproval})`,
    });

    res.json({ ok: true });
  });

  router.delete('/relationships/:id', requireOrgPerm('can_delete'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM org_relationships WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Relationship not found' });
      return;
    }

    if (
      existing.relationship_type === 'reporting' &&
      existing.source_type === 'position' &&
      existing.target_type === 'position'
    ) {
      db.prepare('UPDATE org_positions SET reports_to_position_id = NULL WHERE id = ? AND reports_to_position_id = ?').run(
        String(existing.target_id),
        String(existing.source_id)
      );
    }

    db.prepare('DELETE FROM org_relationships WHERE id = ?').run(id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_DELETE_RELATIONSHIP',
      entityType: 'org_relationship',
      entityId: id,
      details: `Deleted relationship ${id}`,
    });

    res.json({ ok: true });
  });

  // ==================== RACI MATRIX ====================
  router.post('/raci', requireOrgPerm('can_create'), (req: AuthRequest, res: Response) => {
    const body = req.body as Partial<OrgRaciEntry>;
    if (!body.process_name?.trim()) {
      res.status(400).json({ error: 'Process name is required.' });
      return;
    }

    const requestedApproval: OrgApprovalStatus =
      body.approval_status && VALID_APPROVAL_STATUSES.includes(body.approval_status)
        ? body.approval_status
        : 'proposed';
    if (requestedApproval === 'approved' && !req.orgPerms?.can_approve) {
      res.status(403).json({ error: 'Forbidden: Approve permission required.' });
      return;
    }

    const id = generateId('raci');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO org_raci (
        id, process_name, process_name_ar, department_id, owner_position_id, assignments_json, approval_status, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.process_name.trim(),
      (body.process_name_ar || '').trim(),
      body.department_id || null,
      body.owner_position_id || null,
      JSON.stringify(body.assignments || {}),
      requestedApproval,
      (body.notes || '').trim(),
      now
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_CREATE_RACI',
      entityType: 'org_raci',
      entityId: id,
      details: `Created RACI entry: ${body.process_name.trim()}`,
    });

    res.status(201).json({ id });
  });

  router.patch('/raci/:id', requireOrgPerm('can_edit'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM org_raci WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'RACI record not found' });
      return;
    }

    const body = req.body as Partial<OrgRaciEntry>;
    if (body.approval_status !== undefined && body.approval_status !== existing.approval_status) {
      if (body.approval_status === 'approved' && !req.orgPerms?.can_approve) {
        res.status(403).json({ error: 'Forbidden: Approve permission required.' });
        return;
      }
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE org_raci SET
        process_name = ?, process_name_ar = ?, department_id = ?, owner_position_id = ?,
        assignments_json = ?, approval_status = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      body.process_name !== undefined ? String(body.process_name).trim() : String(existing.process_name),
      body.process_name_ar !== undefined ? String(body.process_name_ar).trim() : String(existing.process_name_ar || ''),
      body.department_id !== undefined ? body.department_id || null : existing.department_id,
      body.owner_position_id !== undefined ? body.owner_position_id || null : existing.owner_position_id,
      body.assignments !== undefined ? JSON.stringify(body.assignments) : String(existing.assignments_json),
      body.approval_status || String(existing.approval_status),
      body.notes !== undefined ? String(body.notes).trim() : String(existing.notes || ''),
      now,
      id
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_UPDATE_RACI',
      entityType: 'org_raci',
      entityId: id,
      details: `Updated RACI entry ${id}`,
    });

    res.json({ ok: true });
  });

  router.delete('/raci/:id', requireOrgPerm('can_delete'), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM org_raci WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'RACI record not found' });
      return;
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_DELETE_RACI',
      entityType: 'org_raci',
      entityId: id,
      details: `Deleted RACI entry ${id}`,
    });

    res.json({ ok: true });
  });

  // ==================== RBAC PERMISSIONS & ROLE ASSIGNMENTS ====================
  router.put('/permissions/:roleKey', requireOrgPerm('can_approve'), (req: AuthRequest, res: Response) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: portal administrator privileges required.' });
      return;
    }
    const { roleKey } = req.params;
    if (roleKey === 'public_visitor') {
      res.status(400).json({ error: 'Public Visitor must remain strictly blocked from internal organizational data.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM org_role_permissions WHERE role_key = ?').get(roleKey);
    if (!existing) {
      res.status(404).json({ error: 'System role not found' });
      return;
    }

    const body = req.body as Partial<OrgRolePermission>;
    db.prepare(
      `UPDATE org_role_permissions SET
        can_view = ?, can_create = ?, can_edit = ?, can_delete = ?,
        can_archive = ?, can_review = ?, can_approve = ?, can_publish = ?
       WHERE role_key = ?`
    ).run(
      body.can_view ? 1 : 0,
      body.can_create ? 1 : 0,
      body.can_edit ? 1 : 0,
      body.can_delete ? 1 : 0,
      body.can_archive ? 1 : 0,
      body.can_review ? 1 : 0,
      body.can_approve ? 1 : 0,
      body.can_publish ? 1 : 0,
      roleKey
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_UPDATE_RBAC_MATRIX',
      entityType: 'org_role_permission',
      entityId: roleKey,
      details: `Updated RBAC permissions matrix for role ${roleKey}`,
    });

    res.json({ ok: true });
  });

  router.get('/user-roles', requireOrgPerm('can_approve'), (req: AuthRequest, res: Response) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: portal administrator privileges required.' });
      return;
    }
    // Intentionally excludes employee names, photos, and personal emails (PII-free structural mapping)
    const rows = db
      .prepare(
        `SELECT u.id as user_id, u.role as portal_role, u.department as portal_department,
                COALESCE(r.org_role_key, CASE WHEN u.role = 'admin' THEN 'super_admin' ELSE 'internal_viewer' END) as org_role_key
         FROM users u
         LEFT JOIN org_user_roles r ON r.user_id = u.id
         WHERE u.role IN ('admin', 'assessor') AND u.active = 1
         ORDER BY u.role, u.id`
      )
      .all();

    res.json({ user_roles: rows });
  });

  router.put('/user-roles/:userId', requireOrgPerm('can_approve'), (req: AuthRequest, res: Response) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: portal administrator privileges required.' });
      return;
    }
    const { userId } = req.params;
    const { org_role_key } = req.body as { org_role_key?: OrgSystemRoleKey };

    const targetUser = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as
      | { id: string; role: string }
      | undefined;
    if (!targetUser || targetUser.role === 'candidate') {
      res.status(400).json({ error: 'Only internal staff accounts can be assigned organizational module roles.' });
      return;
    }

    if (!org_role_key || !db.prepare('SELECT role_key FROM org_role_permissions WHERE role_key = ?').get(org_role_key)) {
      res.status(400).json({ error: 'Invalid org_role_key.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO org_user_roles (user_id, org_role_key, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET org_role_key = excluded.org_role_key, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).run(userId, org_role_key, req.user!.id, now);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.id,
      userRole: req.orgRole || req.user!.role,
      action: 'ORG_ASSIGN_USER_ROLE',
      entityType: 'org_user_role',
      entityId: userId,
      details: `Assigned system role ${org_role_key} to internal account ${userId}`,
    });

    res.json({ ok: true });
  });

  // ==================== AUDIT LOG & INTEGRATION MONITOR ====================
  router.get('/audit-logs', requireOrgPerm('can_review'), (_req: AuthRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT id, user_id, user_role, action, entity_type, entity_id, details, created_at
         FROM audit_logs
         WHERE entity_type LIKE 'org_%' OR action LIKE 'ORG_%'
         ORDER BY created_at DESC LIMIT 120`
      )
      .all();
    res.json({ logs: rows });
  });

  router.get('/integration-status', async (_req: AuthRequest, res: Response) => {
    const departments = db.prepare('SELECT * FROM org_departments').all() as Array<Record<string, unknown>>;
    const positions = db.prepare('SELECT * FROM org_positions').all() as Array<Record<string, unknown>>;
    const relationships = db.prepare('SELECT id FROM org_relationships').all();
    const raciRows = db.prepare('SELECT id FROM org_raci').all();
    const portalJobs = db
      .prepare("SELECT id, title, title_ar, department, status FROM jobs WHERE status != 'archived'")
      .all() as Array<{ id: string; title: string; title_ar: string; department: string; status: string }>;
    const staffAccounts = db
      .prepare("SELECT id, department FROM users WHERE role IN ('admin', 'assessor') AND active = 1")
      .all() as Array<{ id: string; department: string }>;

    const inconsistencies: OrgConsistencyIssue[] = [];

    // 1. Check portal jobs not yet linked to any org position
    const linkedJobIds = new Set(positions.map((p) => p.linked_job_id).filter(Boolean).map(String));
    for (const j of portalJobs) {
      if (!linkedJobIds.has(j.id)) {
        inconsistencies.push({
          id: `unlinked-job-${j.id}`,
          severity: 'warning',
          source: 'jobs',
          title: `Portal job "${j.title}" is not linked to an organizational position`,
          title_ar: `الوظيفة "${j.title_ar || j.title}" غير مرتبطة بمنصب في الهيكل التنظيمي`,
          details: `Job ${j.id} (${j.department}) has not been mapped to an official OrgPosition record.`,
          details_ar: `الوظيفة ${j.id} (${j.department}) لم يتم ربطها بعد بمنصب رسمي في الهيكل التنظيمي.`,
        });
      }
    }

    // 2. Check internal staff departments mapped in org_departments
    const mappedDeptNames = new Set(
      departments.map((d) => String(d.mapped_portal_department || '').trim()).filter(Boolean)
    );
    const unmatchedDepts = new Set<string>();
    for (const st of staffAccounts) {
      if (st.department && !mappedDeptNames.has(st.department)) {
        unmatchedDepts.add(st.department);
      }
    }
    unmatchedDepts.forEach((deptName) => {
      inconsistencies.push({
        id: `unmapped-staff-dept-${deptName}`,
        severity: 'info',
        source: 'users.department',
        title: `Staff portal department "${deptName}" has no direct org department mapping`,
        title_ar: `قسم الموظفين "${deptName}" غير مربوط بإدارة محددة في الهيكل`,
        details: 'Map this department text in Department Manager (mapped_portal_department) to unify reporting.',
        details_ar: 'يمكنك ربط هذا القسم عبر إدارة الأقسام لتوحيد التقارير.',
      });
    });

    // 3. Check pending proposed approvals
    const proposedDepts = departments.filter((d) => d.approval_status === 'proposed').length;
    const proposedPos = positions.filter((p) => p.approval_status === 'proposed').length;
    if (proposedDepts > 0 || proposedPos > 0) {
      inconsistencies.push({
        id: 'pending-proposed-items',
        severity: 'info',
        source: 'org_structure',
        title: `${proposedDepts} proposed departments and ${proposedPos} proposed positions await formal approval`,
        title_ar: `${proposedDepts} إدارة مقترحة و ${proposedPos} منصب مقترح بانتظار الاعتماد الرسمي`,
        details: 'Proposed records remain clearly tagged until reviewed and approved by an authorized administrator.',
        details_ar: 'تبقى السجلات المقترحة موسومة بوضوح حتى تتم مراجعتها واعتمادها رسمياً.',
      });
    }

    // 4. Server-side SheetDB read-only health & external jobs check (never exposes URL/secrets or PII to client)
    const cfg = getValidatedSheetDbUrl();
    let sheetdbConfigured = cfg.configured;
    let sheetdbStatus: OrgIntegrationStatus['sheetdb_status'] = 'not_configured';
    let sheetdbMessage = 'External SheetDB API endpoint is not configured.';
    let sheetdbCounts: OrgIntegrationStatus['sheetdb_counts'] | undefined;
    let sheetdbJobsRef: OrgIntegrationStatus['sheetdb_jobs_reference'] = [];

    if (cfg.configured && !cfg.valid) {
      sheetdbStatus = 'error';
      sheetdbMessage = cfg.error || 'SheetDB endpoint failed allowlist validation.';
    } else if (cfg.valid) {
      try {
        const tabs = await fetchSheetDbTabs();
        sheetdbStatus = 'connected';
        sheetdbCounts = {
          departments: tabs.departments.length,
          team_structural_roles: tabs.teamStructural.length,
          jobs: tabs.jobsReference.length,
        };
        sheetdbJobsRef = tabs.jobsReference;
        sheetdbMessage = `Connected server-side to SheetDB (${tabs.departments.length} Departments, ${tabs.teamStructural.length} structural Team roles [PII stripped], ${tabs.jobsReference.length} external Jobs). Manual review & sync required; no auto-overwrite on startup.`;
      } catch (err) {
        sheetdbStatus = 'error';
        sheetdbMessage = `Unable to fetch SheetDB tabs (${err instanceof Error ? err.message : 'network error'}). SQLite records remain untouched.`;
      }
    }

    // 5. Honest runtime SQLite persistence verification (detect Cloud Run overlay container disk)
    let isOverlayContainer = Boolean(process.env.K_SERVICE);
    try {
      const mounts = fs.readFileSync('/proc/mounts', 'utf8');
      const rootMount = mounts.split('\n').find((line) => line.includes(' / '));
      if (rootMount && rootMount.includes('overlay')) {
        isOverlayContainer = true;
      }
    } catch {
      // ignore if /proc/mounts unavailable
    }

    const portalJobsReference = portalJobs.map((j) => {
      const linkedPos = positions.find((p) => p.linked_job_id === j.id);
      return {
        id: j.id,
        title: j.title,
        title_ar: j.title_ar,
        department: j.department,
        status: j.status,
        linked_position_id: linkedPos ? String(linkedPos.id) : null,
      };
    });

    const payload: OrgIntegrationStatus = {
      database_connected: true,
      database_engine: 'SQLite (data/smart_masar.db · WAL)',
      persistence_mode: isOverlayContainer ? 'ephemeral_container_disk' : 'persistent_volume',
      persistence_warning: isOverlayContainer
        ? 'Cloud Run ephemeral container disk detected (overlay filesystem): SQLite persists across page refreshes, logouts, and active sessions, but NOT permanently across container restarts, scaling to zero, or new deployments without a persistent database/volume.'
        : 'Persistent filesystem storage verified.',
      persistence_warning_ar: isOverlayContainer
        ? 'تنبيه التخزين السحابي: تعمل قاعدة SQLite حالياً على قرص حاوية مؤقت في Cloud Run (overlay)؛ تُحفظ التغييرات عبر تحديث الصفحة وتسجيل الخروج أثناء عمل الحاوية، لكنها لا تدوم عند إعادة تشغيل الحاوية أو إعادة النشر ما لم يتم ربط قاعدة بيانات دائمة أو قرص تخزين دائم.'
        : 'التخزين الدائم لقاعدة البيانات متوفر.',
      sheetdb_configured: sheetdbConfigured,
      sheetdb_status: sheetdbStatus,
      sheetdb_message: sheetdbMessage,
      sheetdb_counts: sheetdbCounts,
      last_checked_at: new Date().toISOString(),
      counts: {
        departments: departments.length,
        approved_departments: departments.filter((d) => d.approval_status === 'approved').length,
        proposed_departments: proposedDepts,
        positions: positions.length,
        approved_positions: positions.filter((p) => p.approval_status === 'approved').length,
        proposed_positions: proposedPos,
        relationships: relationships.length,
        raci_rows: raciRows.length,
        portal_jobs: portalJobs.length,
        portal_staff_accounts: staffAccounts.length,
      },
      inconsistencies,
      portal_jobs_reference: portalJobsReference,
      sheetdb_jobs_reference: sheetdbJobsRef,
    };

    res.json(payload);
  });

  // Read-only Dry-Run Preview of SheetDB Structural Reconciliation (NO DB writes)
  router.get('/sheetdb/preview', requireOrgPerm('can_review'), async (_req: AuthRequest, res: Response) => {
    try {
      const preview = await buildSheetDbReconciliationPreview();
      res.json(preview);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to generate SheetDB reconciliation preview.',
      });
    }
  });

  // Admin-authorized manual idempotent sync (never runs automatically on startup)
  router.post('/sheetdb/sync', requireOrgPerm('can_approve'), async (req: AuthRequest, res: Response) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: portal administrator privileges required to execute SheetDB sync.' });
      return;
    }
    try {
      const result = await applySheetDbReconciliationSync({
        userId: req.user.id,
        userRole: req.orgRole || req.user.role,
      });
      res.json({ ok: true, applied: result });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'SheetDB sync failed cleanly without partial database writes.',
      });
    }
  });

  return router;
}
