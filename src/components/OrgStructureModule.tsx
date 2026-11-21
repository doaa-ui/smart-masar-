import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  Database,
  Edit3,
  GitFork,
  GripVertical,
  History,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Shield,
  Table2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AppLanguage } from '../types/domain';
import type {
  OrgApprovalStatus,
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
  OrgSheetDbSyncPreview,
  OrgSystemRoleKey,
  OrgUserRoleMapping,
  OrgWorkspacePayload,
  RaciLetter,
} from '../types/org';
import {
  formatApprovalStatusLabel,
  formatPositionStatusLabel,
  OrgStructureChart,
} from './OrgStructureChart';

interface OrgStructureModuleProps {
  lang: AppLanguage;
  onWorkspaceChanged?: () => void;
}

type ModuleTab = 'chart' | 'builder' | 'relationships' | 'raci' | 'governance';

interface AuditRow {
  id: string;
  user_id: string;
  user_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

const PERMISSION_COLUMNS: Array<{ key: OrgPermissionKey; en: string; ar: string }> = [
  { key: 'can_view', en: 'View', ar: 'عرض' },
  { key: 'can_create', en: 'Create', ar: 'إنشاء' },
  { key: 'can_edit', en: 'Edit', ar: 'تعديل' },
  { key: 'can_delete', en: 'Delete', ar: 'حذف' },
  { key: 'can_archive', en: 'Archive', ar: 'أرشفة' },
  { key: 'can_review', en: 'Review', ar: 'مراجعة' },
  { key: 'can_approve', en: 'Approve', ar: 'اعتماد' },
  { key: 'can_publish', en: 'Publish', ar: 'نشر' },
];

export const OrgStructureModule: React.FC<OrgStructureModuleProps> = ({ lang, onWorkspaceChanged }) => {
  const [workspace, setWorkspace] = useState<OrgWorkspacePayload | null>(null);
  const [integration, setIntegration] = useState<OrgIntegrationStatus | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [userRoles, setUserRoles] = useState<OrgUserRoleMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ModuleTab>('chart');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: 'department' | 'position' | 'relationship' | 'raci';
    id: string;
    label: string;
  } | null>(null);

  // Drag & Drop state for positions between departments
  const [draggedPosId, setDraggedPosId] = useState<string | null>(null);
  const [dropDeptId, setDropDeptId] = useState<string | null>(null);

  // Modals / Drawers state
  const [editingDept, setEditingDept] = useState<Partial<OrgDepartment> | null>(null);
  const [editingPos, setEditingPos] = useState<Partial<OrgPosition> | null>(null);
  const [editingLevel, setEditingLevel] = useState<Partial<OrgLevel> | null>(null);
  const [editingRel, setEditingRel] = useState<Partial<OrgRelationship> | null>(null);
  const [editingRaci, setEditingRaci] = useState<Partial<OrgRaciEntry> | null>(null);
  const [syncPreview, setSyncPreview] = useState<OrgSheetDbSyncPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const ws = await apiRequest<OrgWorkspacePayload>('/api/org/workspace');
      setWorkspace(ws);

      const intRes = await apiRequest<OrgIntegrationStatus>('/api/org/integration-status');
      setIntegration(intRes);

      if (ws.my_permissions.can_review || ws.my_permissions.can_approve) {
        try {
          const audRes = await apiRequest<{ logs: AuditRow[] }>('/api/org/audit-logs');
          setAuditLogs(audRes.logs);
        } catch {
          setAuditLogs([]);
        }
      } else {
        setAuditLogs([]);
      }

      if (ws.my_permissions.can_approve) {
        try {
          const urRes = await apiRequest<{ user_roles: OrgUserRoleMapping[] }>('/api/org/user-roles');
          setUserRoles(urRes.user_roles);
        } catch {
          setUserRoles([]);
        }
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load organizational workspace.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const notify = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
  };

  const deptMap = useMemo(() => {
    const m = new Map<string, OrgDepartment>();
    workspace?.departments.forEach((d) => m.set(d.id, d));
    return m;
  }, [workspace?.departments]);

  const posMap = useMemo(() => {
    const m = new Map<string, OrgPosition>();
    workspace?.positions.forEach((p) => m.set(p.id, p));
    return m;
  }, [workspace?.positions]);

  const myRoleLabel = useMemo(() => {
    if (!workspace) return '';
    const match = workspace.permissions_matrix.find((r) => r.role_key === workspace.my_role);
    return match ? (lang === 'ar' ? match.role_name_ar || match.role_name : match.role_name) : workspace.my_role;
  }, [workspace, lang]);

  // Core RACI columns (all active departments)
  const activeDepartments = useMemo(
    () => (workspace?.departments || []).filter((d) => d.status === 'active'),
    [workspace?.departments]
  );

  // ==================== MUTATION HANDLERS ====================
  const handleSaveLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLevel) return;
    setSaving(true);
    try {
      if (editingLevel.id) {
        await apiRequest(`/api/org/levels/${editingLevel.id}`, {
          method: 'PUT',
          body: JSON.stringify(editingLevel),
        });
      } else {
        await apiRequest('/api/org/levels', {
          method: 'POST',
          body: JSON.stringify(editingLevel),
        });
      }
      setEditingLevel(null);
      await loadWorkspace();
      notify('success', lang === 'ar' ? 'تم حفظ المستوى التنظيمي بنجاح.' : 'Organizational level saved.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save level');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDept) return;
    setSaving(true);
    try {
      if (editingDept.id) {
        await apiRequest(`/api/org/departments/${editingDept.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editingDept),
        });
      } else {
        await apiRequest('/api/org/departments', {
          method: 'POST',
          body: JSON.stringify(editingDept),
        });
      }
      setEditingDept(null);
      await loadWorkspace();
      onWorkspaceChanged?.();
      notify('success', lang === 'ar' ? 'تم حفظ الإدارة في قاعدة البيانات.' : 'Department saved to database.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPos) return;
    setSaving(true);
    try {
      if (editingPos.id) {
        await apiRequest(`/api/org/positions/${editingPos.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editingPos),
        });
      } else {
        await apiRequest('/api/org/positions', {
          method: 'POST',
          body: JSON.stringify(editingPos),
        });
      }
      setEditingPos(null);
      await loadWorkspace();
      onWorkspaceChanged?.();
      notify('success', lang === 'ar' ? 'تم حفظ بطاقة المنصب الوظيفي بنجاح.' : 'Position profile saved to database.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save position');
    } finally {
      setSaving(false);
    }
  };

  const handleMovePositionDepartment = async (posId: string, targetDeptId: string) => {
    const pos = posMap.get(posId);
    if (!pos || pos.department_id === targetDeptId) return;
    setSaving(true);
    try {
      await apiRequest(`/api/org/positions/${posId}`, {
        method: 'PATCH',
        body: JSON.stringify({ department_id: targetDeptId }),
      });
      await loadWorkspace();
      notify('success', lang === 'ar' ? 'تم نقل المنصب إلى الإدارة الجديدة.' : 'Position moved to target department.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to move position');
    } finally {
      setSaving(false);
    }
  };

  const handleReorderPosition = async (pos: OrgPosition, delta: number) => {
    setSaving(true);
    try {
      await apiRequest(`/api/org/positions/${pos.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sort_order: Math.max(1, pos.sort_order + delta) }),
      });
      await loadWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to reorder position');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRel) return;
    setSaving(true);
    try {
      if (editingRel.id) {
        await apiRequest(`/api/org/relationships/${editingRel.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editingRel),
        });
      } else {
        await apiRequest('/api/org/relationships', {
          method: 'POST',
          body: JSON.stringify(editingRel),
        });
      }
      setEditingRel(null);
      await loadWorkspace();
      notify('success', lang === 'ar' ? 'تم حفظ العلاقة التنظيمية بنجاح.' : 'Organizational relationship saved.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save relationship');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRaci = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRaci) return;
    setSaving(true);
    try {
      if (editingRaci.id) {
        await apiRequest(`/api/org/raci/${editingRaci.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editingRaci),
        });
      } else {
        await apiRequest('/api/org/raci', {
          method: 'POST',
          body: JSON.stringify(editingRaci),
        });
      }
      setEditingRaci(null);
      await loadWorkspace();
      notify('success', lang === 'ar' ? 'تم حفظ صف مصفوفة RACI بنجاح.' : 'RACI row saved to database.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save RACI');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRaciCell = async (entry: OrgRaciEntry, deptId: string, letter: RaciLetter) => {
    if (!workspace?.my_permissions.can_edit) return;
    setSaving(true);
    try {
      const nextAssignments = { ...entry.assignments, [deptId]: letter };
      if (!letter) delete nextAssignments[deptId];
      await apiRequest(`/api/org/raci/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignments: nextAssignments }),
      });
      await loadWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update RACI cell');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRolePerm = async (roleRow: OrgRolePermission, permKey: OrgPermissionKey) => {
    if (roleRow.role_key === 'public_visitor') return;
    setSaving(true);
    try {
      const updated = { ...roleRow, [permKey]: !roleRow[permKey] };
      await apiRequest(`/api/org/permissions/${roleRow.role_key}`, {
        method: 'PUT',
        body: JSON.stringify(updated),
      });
      await loadWorkspace();
      notify('success', lang === 'ar' ? 'تم تحديث مصفوفة الصلاحيات.' : 'RBAC permission matrix updated.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update permission');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateUserOrgRole = async (userId: string, orgRoleKey: OrgSystemRoleKey) => {
    setSaving(true);
    try {
      await apiRequest(`/api/org/user-roles/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ org_role_key: orgRoleKey }),
      });
      await loadWorkspace();
      notify('success', lang === 'ar' ? 'تم تحديث الدور النظامي للمستخدم.' : 'User system role updated.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update user role');
    } finally {
      setSaving(false);
    }
  };

  const executeConfirmDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      const endpointMap = {
        department: `/api/org/departments/${confirmDelete.id}`,
        position: `/api/org/positions/${confirmDelete.id}`,
        relationship: `/api/org/relationships/${confirmDelete.id}`,
        raci: `/api/org/raci/${confirmDelete.id}`,
      };
      await apiRequest(endpointMap[confirmDelete.kind], { method: 'DELETE' });
      setConfirmDelete(null);
      await loadWorkspace();
      notify('success', lang === 'ar' ? 'تم الحذف بنجاح.' : 'Record deleted.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Delete failed');
      setConfirmDelete(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !workspace) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        {lang === 'ar' ? 'جاري تحميل بيانات الهيكل التنظيمي...' : 'Loading Organizational Structure workspace...'}
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-700">
        {feedback?.text || (lang === 'ar' ? 'تعذر الوصول إلى وحدة الهيكل التنظيمي.' : 'Unable to access Organizational Structure module.')}
      </div>
    );
  }

  const perms = workspace.my_permissions;

  const canManageStructure = Boolean(perms.can_create || perms.can_edit || perms.can_approve || perms.can_archive);
  const canAccessGovernance = Boolean(perms.can_review || perms.can_approve);

  const tabs: Array<{ key: ModuleTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'chart', label: lang === 'ar' ? 'الهيكل التفاعلي' : 'Interactive Org Chart', icon: Network },
    ...(canManageStructure
      ? [{ key: 'builder' as ModuleTab, label: lang === 'ar' ? 'مُنشئ الهيكل والمناصب' : 'Builder & Positions', icon: Building2 }]
      : []),
    { key: 'relationships', label: lang === 'ar' ? 'العلاقات التنظيمية' : 'Relationships', icon: GitFork },
    { key: 'raci', label: lang === 'ar' ? 'مصفوفة RACI' : 'RACI Matrix', icon: Table2 },
    ...(canAccessGovernance
      ? [{ key: 'governance' as ModuleTab, label: lang === 'ar' ? 'الصلاحيات والتدقيق والتكامل' : 'RBAC, Audit & Monitor', icon: Shield }]
      : []),
  ];

  const approvedDeptsCount = workspace.departments.filter((d) => d.approval_status === 'approved').length;
  const proposedDeptsCount = workspace.departments.filter((d) => d.approval_status === 'proposed').length;
  const approvedPosCount = workspace.positions.filter((p) => p.approval_status === 'approved').length;
  const proposedPosCount = workspace.positions.filter((p) => p.approval_status === 'proposed').length;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-blue-800">{lang === 'ar' ? 'وحدة داخلية محمية' : 'Internal Protected Module'}</span>
            <span>·</span>
            <span>
              {lang === 'ar' ? 'دورك النظامي:' : 'System Role:'}{' '}
              <strong className="text-slate-900">{myRoleLabel}</strong>
            </span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 mt-1">
            {lang === 'ar'
              ? 'إدارة الهيكل التنظيمي والصلاحيات — مسار الذكي'
              : 'Organizational Structure & Governance — Smart Masar'}
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {lang === 'ar'
              ? 'هيكل تنظيمي مرن مرتبط مباشرة بقاعدة البيانات مع التمييز الصارم بين السجلات المعتمدة والمقترحة وحماية كاملة لخصوصية البيانات.'
              : 'Database-backed organizational chart, RACI matrix, and RBAC governance separating approved records from proposed structures with zero PII exposure.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void loadWorkspace()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {lang === 'ar' ? 'تحديث البيانات' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{lang === 'ar' ? 'المستويات المرنة' : 'Org Levels'}</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{workspace.levels.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{lang === 'ar' ? 'قابلة للتعديل والتوسيع' : 'Editable hierarchy'}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{lang === 'ar' ? 'الإدارات والأقسام' : 'Departments'}</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{workspace.departments.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {approvedDeptsCount} {lang === 'ar' ? 'معتمدة' : 'approved'} · {proposedDeptsCount}{' '}
            {lang === 'ar' ? 'مقترحة' : 'proposed'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{lang === 'ar' ? 'المناصب الوظيفية' : 'Positions'}</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{workspace.positions.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {approvedPosCount} {lang === 'ar' ? 'معتمد' : 'approved'} · {proposedPosCount}{' '}
            {lang === 'ar' ? 'مقترح' : 'proposed'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{lang === 'ar' ? 'العلاقات التنظيمية' : 'Relationships'}</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{workspace.relationships.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{lang === 'ar' ? 'رأسية وأفقية واستشارية' : 'Reporting & Collab'}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{lang === 'ar' ? 'مسارات RACI' : 'RACI Workflows'}</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{workspace.raci.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{lang === 'ar' ? 'توزيع المسؤوليات' : 'Shared accountability'}</div>
        </div>
      </div>

      {/* Inline Feedback Banner */}
      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="text-current hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Inline Delete Confirmation Bar (zero window.confirm) */}
      {confirmDelete && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-red-900">
          <span>
            {lang === 'ar'
              ? `تأكيد الحذف الدائم للسجل: "${confirmDelete.label}"؟`
              : `Confirm permanent deletion of "${confirmDelete.label}"?`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 rounded-lg border border-red-200 bg-white text-slate-700 font-medium"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              onClick={() => void executeConfirmDelete()}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white font-medium"
            >
              {lang === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Module Sub-Navigation Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                active ? 'bg-[#0B1D3A] text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ==================== TAB 1: INTERACTIVE CHART ==================== */}
      {activeTab === 'chart' && (
        <OrgStructureChart
          lang={lang}
          levels={workspace.levels}
          departments={workspace.departments}
          positions={workspace.positions}
          relationships={workspace.relationships}
          permissions={perms}
          onEditPosition={(pos) => {
            setEditingPos({ ...pos });
            setActiveTab('builder');
          }}
        />
      )}

      {/* ==================== TAB 2: BUILDER, LEVELS, DEPARTMENTS & POSITIONS ==================== */}
      {activeTab === 'builder' && (
        <div className="space-y-6">
          {/* Section A: Flexible Organizational Levels */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-700" />
                  {lang === 'ar' ? 'المستويات التنظيمية المرنة' : 'Flexible Organizational Levels'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === 'ar'
                    ? 'مستويات قابلة للتعديل والتوسيع بدون إلزام كل إدارة بنفس عدد المستويات.'
                    : 'Editable hierarchy tiers; departments are never forced to contain identical level counts.'}
                </p>
              </div>
              {perms.can_create && (
                <button
                  onClick={() =>
                    setEditingLevel({
                      level_number: workspace.levels.length + 1,
                      code: `L${workspace.levels.length + 1}`,
                      name: '',
                      name_ar: '',
                      description: '',
                      description_ar: '',
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {lang === 'ar' ? 'إضافة مستوى' : 'Add Level'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {workspace.levels.map((lvl) => (
                <div key={lvl.id} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs font-mono text-blue-800 font-bold">
                      <span>{lvl.code}</span>
                      {perms.can_edit && (
                        <button
                          onClick={() => setEditingLevel({ ...lvl })}
                          className="text-slate-500 hover:text-blue-700"
                          title={lang === 'ar' ? 'تعديل المستوى' : 'Edit Level'}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="font-bold text-xs text-slate-900 mt-1">
                      {lang === 'ar' ? lvl.name_ar || lvl.name : lvl.name}
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      {lang === 'ar' ? lvl.description_ar || lvl.description : lvl.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section B: Department Manager */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-700" />
                  {lang === 'ar' ? 'إدارة الأقسام والوحدات' : 'Department Manager'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === 'ar'
                    ? 'مع الحفاظ على المعرفات الثابتة في قاعدة البيانات والربط الآمن مع أقسام البوابة.'
                    : 'Preserves stable database IDs and portal department mappings.'}
                </p>
              </div>
              {perms.can_create && (
                <button
                  onClick={() =>
                    setEditingDept({
                      code: '',
                      name: '',
                      name_ar: '',
                      parent_department_id: 'dept-exec',
                      description: '',
                      description_ar: '',
                      mapped_portal_department: '',
                      approval_status: 'proposed',
                      status: 'active',
                      sort_order: workspace.departments.length + 1,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {lang === 'ar' ? 'إضافة إدارة / قسم' : 'Add Department'}
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-start border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                    <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الرمز' : 'Code'}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الإدارة / القسم' : 'Department'}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'ربط البوابة' : 'Portal Mapping'}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'المناصب' : 'Positions'}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الاعتماد والحالة' : 'Approval & Status'}</th>
                    <th className="py-2.5 px-3 text-end font-semibold">{lang === 'ar' ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workspace.departments.map((d) => {
                    const deptPositions = workspace.positions.filter((p) => p.department_id === d.id);
                    return (
                      <tr key={d.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono text-slate-700">{d.code}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">
                            {lang === 'ar' ? d.name_ar || d.name : d.name}
                          </div>
                          <div className="text-[11px] text-slate-500">{lang === 'ar' ? d.name : d.name_ar}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{d.mapped_portal_department || '—'}</td>
                        <td className="py-2.5 px-3 tabular-nums font-medium text-slate-800">{deptPositions.length}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`font-semibold ${
                              d.approval_status === 'approved' ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {formatApprovalStatusLabel(d.approval_status, lang)}
                          </span>
                          <span className="text-slate-400"> · </span>
                          <span className={d.status === 'archived' ? 'text-slate-500' : 'text-slate-700'}>
                            {d.status === 'archived'
                              ? lang === 'ar'
                                ? 'مؤرشف'
                                : 'Archived'
                              : lang === 'ar'
                              ? 'نشط'
                              : 'Active'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {perms.can_edit && (
                              <button
                                onClick={() => setEditingDept({ ...d })}
                                className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-700"
                                title={lang === 'ar' ? 'تعديل' : 'Edit'}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {perms.can_approve && d.approval_status !== 'approved' && (
                              <button
                                onClick={() =>
                                  void apiRequest(`/api/org/departments/${d.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ approval_status: 'approved' }),
                                  }).then(() => {
                                    void loadWorkspace();
                                    notify('success', lang === 'ar' ? 'تم اعتماد الإدارة.' : 'Department approved.');
                                  })
                                }
                                className="p-1.5 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800"
                                title={lang === 'ar' ? 'اعتماد' : 'Approve'}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {perms.can_archive && (
                              <button
                                onClick={() =>
                                  void apiRequest(`/api/org/departments/${d.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ status: d.status === 'active' ? 'archived' : 'active' }),
                                  }).then(() => loadWorkspace())
                                }
                                className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-700"
                                title={d.status === 'active' ? (lang === 'ar' ? 'أرشفة' : 'Archive') : lang === 'ar' ? 'استعادة' : 'Restore'}
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {perms.can_delete && deptPositions.length === 0 && (
                              <button
                                onClick={() =>
                                  setConfirmDelete({
                                    kind: 'department',
                                    id: d.id,
                                    label: lang === 'ar' ? d.name_ar || d.name : d.name,
                                  })
                                }
                                className="p-1.5 rounded border border-red-200 hover:bg-red-50 text-red-700"
                                title={lang === 'ar' ? 'حذف' : 'Delete'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section C: Visual Drag-and-Drop Organization Builder & Positions Board */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {lang === 'ar'
                    ? 'مُنشئ المناصب والشواغر (دعم السحب والإفلات بين الإدارات)'
                    : 'Positions & Vacancies Builder (Drag-and-Drop Across Departments)'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === 'ar'
                    ? 'اسحب أي منصب لنقله إلى إدارة أخرى أو استخدم القوائم المباشرة، مع تتبع الشواغر بدون كشف بيانات الموظفين.'
                    : 'Drag position cards onto any department panel to reassign, reorder priority, or edit complete 17-field job profiles.'}
                </p>
              </div>
              {perms.can_create && (
                <button
                  onClick={() =>
                    setEditingPos({
                      code: '',
                      department_id: activeDepartments[0]?.id || '',
                      level_id: 'lvl-4',
                      level_number: 4,
                      title: '',
                      title_ar: '',
                      position_status: 'proposed',
                      approval_status: 'proposed',
                      linked_job_id: null,
                      occupied_count: 0,
                      main_objective: '',
                      main_objective_ar: '',
                      key_tasks: [],
                      responsibilities: [],
                      scope_of_authority: '',
                      functional_permissions: [],
                      decision_boundaries: '',
                      required_reports: [],
                      kpis: [],
                      expected_deliverables: [],
                      reports_to_position_id: null,
                      sort_order: workspace.positions.length + 1,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {lang === 'ar' ? 'إضافة منصب جديد (مقترح)' : 'New Position (Proposed)'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {activeDepartments.map((dept) => {
                const deptPositions = workspace.positions
                  .filter((p) => p.department_id === dept.id)
                  .sort((a, b) => a.level_number - b.level_number || a.sort_order - b.sort_order);
                const isDropTarget = dropDeptId === dept.id;

                return (
                  <div
                    key={dept.id}
                    onDragOver={(e) => {
                      if (!perms.can_edit || !draggedPosId) return;
                      e.preventDefault();
                      setDropDeptId(dept.id);
                    }}
                    onDragLeave={() => {
                      if (dropDeptId === dept.id) setDropDeptId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropDeptId(null);
                      if (draggedPosId && perms.can_edit) {
                        void handleMovePositionDepartment(draggedPosId, dept.id);
                      }
                      setDraggedPosId(null);
                    }}
                    className={`rounded-xl border p-4 space-y-3 transition-colors ${
                      isDropTarget ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-mono text-slate-500">
                          {dept.code} · {formatApprovalStatusLabel(dept.approval_status, lang)}
                        </div>
                        <div className="font-bold text-xs text-slate-900 truncate">
                          {lang === 'ar' ? dept.name_ar || dept.name : dept.name}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-slate-600 tabular-nums shrink-0">
                        {deptPositions.length} {lang === 'ar' ? 'منصب' : 'pos'}
                      </span>
                    </div>

                    {deptPositions.length === 0 ? (
                      <div className="border border-dashed border-slate-300 rounded-lg p-4 text-center text-[11px] text-slate-500">
                        {lang === 'ar'
                          ? 'لا توجد مناصب مسجلة حالياً — اسحب منصباً هنا أو أنشئ منصباً جديداً.'
                          : 'No positions assigned yet — drag a position here or create one.'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {deptPositions.map((pos) => (
                          <div
                            key={pos.id}
                            draggable={perms.can_edit}
                            onDragStart={() => setDraggedPosId(pos.id)}
                            onDragEnd={() => {
                              setDraggedPosId(null);
                              setDropDeptId(null);
                            }}
                            className="bg-white border border-slate-200 rounded-lg p-3 space-y-2 shadow-2xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2 min-w-0">
                                {perms.can_edit && (
                                  <GripVertical className="w-4 h-4 text-slate-400 shrink-0 mt-0.5 cursor-grab" />
                                )}
                                <div className="min-w-0">
                                  <div className="text-[11px] font-mono text-slate-500">
                                    {pos.code} · L{pos.level_number} ·{' '}
                                    <span
                                      className={
                                        pos.approval_status === 'approved' ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'
                                      }
                                    >
                                      {formatApprovalStatusLabel(pos.approval_status, lang)}
                                    </span>
                                  </div>
                                  <div className="font-semibold text-xs text-slate-900">
                                    {lang === 'ar' ? pos.title_ar || pos.title : pos.title}
                                  </div>
                                  <div className="text-[11px] text-slate-600 mt-0.5">
                                    {formatPositionStatusLabel(pos.position_status, pos.occupied_count, lang)}
                                    {pos.linked_job_title ? ` · 🔗 ${pos.linked_job_title}` : ''}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {perms.can_edit && (
                                  <>
                                    <button
                                      onClick={() => void handleReorderPosition(pos, -1)}
                                      className="p-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
                                      title={lang === 'ar' ? 'رفع الترتيب' : 'Move up'}
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => void handleReorderPosition(pos, 1)}
                                      className="p-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
                                      title={lang === 'ar' ? 'خفض الترتيب' : 'Move down'}
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => setEditingPos({ ...pos })}
                                      className="p-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-700"
                                      title={lang === 'ar' ? 'تعديل البطاقة الكاملة' : 'Edit full profile'}
                                    >
                                      <Edit3 className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                                {perms.can_approve && pos.approval_status !== 'approved' && (
                                  <button
                                    onClick={() =>
                                      void apiRequest(`/api/org/positions/${pos.id}`, {
                                        method: 'PATCH',
                                        body: JSON.stringify({ approval_status: 'approved' }),
                                      }).then(() => {
                                        void loadWorkspace();
                                        notify('success', lang === 'ar' ? 'تم اعتماد المنصب.' : 'Position approved.');
                                      })
                                    }
                                    className="p-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800"
                                    title={lang === 'ar' ? 'اعتماد' : 'Approve'}
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                  </button>
                                )}
                                {perms.can_delete && (
                                  <button
                                    onClick={() =>
                                      setConfirmDelete({
                                        kind: 'position',
                                        id: pos.id,
                                        label: lang === 'ar' ? pos.title_ar || pos.title : pos.title,
                                      })
                                    }
                                    className="p-1 rounded border border-red-200 hover:bg-red-50 text-red-700"
                                    title={lang === 'ar' ? 'حذف' : 'Delete'}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {perms.can_edit && (
                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-500">{lang === 'ar' ? 'نقل الإدارة:' : 'Move Dept:'}</span>
                                <select
                                  value={pos.department_id}
                                  onChange={(e) => void handleMovePositionDepartment(pos.id, e.target.value)}
                                  className="px-2 py-1 border border-slate-200 rounded bg-slate-50 text-slate-700 max-w-[200px]"
                                >
                                  {activeDepartments.map((optDept) => (
                                    <option key={optDept.id} value={optDept.id}>
                                      {lang === 'ar' ? optDept.name_ar || optDept.name : optDept.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: RELATIONSHIPS ==================== */}
      {activeTab === 'relationships' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <GitFork className="w-4 h-4 text-blue-700" />
                {lang === 'ar'
                  ? 'العلاقات التنظيمية (الرأسية، التعاونية، والاستشارية)'
                  : 'Organizational Relationships (Reporting, Collaboration & Advisory)'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ar'
                  ? 'يميز النظام بين التبعية الإدارية المباشرة (خط متصل) وعلاقات التعاون الأفقي (خط متقطع) والمكاتب الاستشارية.'
                  : 'Clearly separates direct reporting authority from horizontal collaboration and non-managerial advisory ties.'}
              </p>
            </div>
            {perms.can_create && (
              <button
                onClick={() =>
                  setEditingRel({
                    relationship_type: 'collaboration',
                    source_type: 'department',
                    source_id: activeDepartments[0]?.id || '',
                    target_type: 'department',
                    target_id: activeDepartments[1]?.id || activeDepartments[0]?.id || '',
                    label: '',
                    label_ar: '',
                    notes: '',
                    approval_status: 'proposed',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'إضافة علاقة جديدة' : 'Add Relationship'}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                  <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'النوع' : 'Type'}</th>
                  <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'المصدر (من)' : 'Source'}</th>
                  <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الهدف (إلى)' : 'Target'}</th>
                  <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الوصف والملاحظات' : 'Label & Notes'}</th>
                  <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الاعتماد' : 'Approval'}</th>
                  <th className="py-2.5 px-3 text-end font-semibold">{lang === 'ar' ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workspace.relationships.map((rel) => {
                  const getName = (kind: 'department' | 'position', id: string) => {
                    if (kind === 'department') {
                      const d = deptMap.get(id);
                      return d ? (lang === 'ar' ? d.name_ar || d.name : d.name) : id;
                    }
                    const p = posMap.get(id);
                    return p ? `${lang === 'ar' ? p.title_ar || p.title : p.title} (${p.code})` : id;
                  };

                  const typeLabel =
                    rel.relationship_type === 'reporting'
                      ? lang === 'ar'
                        ? 'تبعية رأسية (صلب)'
                        : 'Vertical Reporting (Solid)'
                      : rel.relationship_type === 'collaboration'
                      ? lang === 'ar'
                        ? 'تعاون أفقي (متقطع)'
                        : 'Horizontal Collab (Dashed)'
                      : rel.relationship_type === 'advisory'
                      ? lang === 'ar'
                        ? 'استشاري (غير إداري)'
                        : 'Advisory'
                      : lang === 'ar'
                      ? 'مصفوفي'
                      : 'Matrix';

                  return (
                    <tr key={rel.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-medium text-slate-800 whitespace-nowrap">{typeLabel}</td>
                      <td className="py-2.5 px-3 text-slate-900 font-medium">{getName(rel.source_type, rel.source_id)}</td>
                      <td className="py-2.5 px-3 text-slate-900 font-medium">{getName(rel.target_type, rel.target_id)}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800">
                          {lang === 'ar' ? rel.label_ar || rel.label : rel.label || '—'}
                        </div>
                        {rel.notes && <div className="text-[11px] text-slate-500 mt-0.5">{rel.notes}</div>}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-semibold ${
                            rel.approval_status === 'approved' ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {formatApprovalStatusLabel(rel.approval_status, lang)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-end">
                        <div className="inline-flex items-center gap-1.5">
                          {perms.can_edit && (
                            <button
                              onClick={() => setEditingRel({ ...rel })}
                              className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-700"
                              title={lang === 'ar' ? 'تعديل' : 'Edit'}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {perms.can_approve && rel.approval_status !== 'approved' && (
                            <button
                              onClick={() =>
                                void apiRequest(`/api/org/relationships/${rel.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ approval_status: 'approved' }),
                                }).then(() => {
                                  void loadWorkspace();
                                  notify('success', lang === 'ar' ? 'تم اعتماد العلاقة.' : 'Relationship approved.');
                                })
                              }
                              className="p-1.5 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800"
                              title={lang === 'ar' ? 'اعتماد' : 'Approve'}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {perms.can_delete && (
                            <button
                              onClick={() =>
                                setConfirmDelete({
                                  kind: 'relationship',
                                  id: rel.id,
                                  label: lang === 'ar' ? rel.label_ar || rel.label || rel.id : rel.label || rel.id,
                                })
                              }
                              className="p-1.5 rounded border border-red-200 hover:bg-red-50 text-red-700"
                              title={lang === 'ar' ? 'حذف' : 'Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== TAB 4: RACI MATRIX ==================== */}
      {activeTab === 'raci' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Table2 className="w-4 h-4 text-blue-700" />
                {lang === 'ar' ? 'مصفوفة المسؤوليات المشتركة (RACI Matrix)' : 'Cross-Departmental RACI Matrix'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ar'
                  ? 'R = مسؤول التنفيذ · A = صاحب المساءلة والاعتماد · C = يُستشار · I = يُبلّغ. اضغط على أي خلية لتعديلها وحفظها مباشرة.'
                  : 'R = Responsible · A = Accountable · C = Consulted · I = Informed. Click any cell to update and persist.'}
              </p>
            </div>
            {perms.can_create && (
              <button
                onClick={() =>
                  setEditingRaci({
                    process_name: '',
                    process_name_ar: '',
                    department_id: activeDepartments[0]?.id || null,
                    owner_position_id: null,
                    assignments: {},
                    approval_status: 'proposed',
                    notes: '',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'إضافة إجراء / مسار عمل' : 'Add Process Row'}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 text-start font-semibold min-w-[220px]">
                    {lang === 'ar' ? 'العملية / المسؤولية المشتركة' : 'Shared Process / Deliverable'}
                  </th>
                  {activeDepartments.map((d) => (
                    <th key={d.id} className="py-2.5 px-2 text-center font-semibold min-w-[90px]">
                      <div className="font-mono text-[10px] text-slate-400">{d.code}</div>
                      <div className="truncate max-w-[110px] mx-auto" title={lang === 'ar' ? d.name_ar || d.name : d.name}>
                        {lang === 'ar' ? d.name_ar || d.name : d.name}
                      </div>
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الحالة' : 'Approval'}</th>
                  <th className="py-2.5 px-3 text-end font-semibold">{lang === 'ar' ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workspace.raci.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">
                        {lang === 'ar' ? row.process_name_ar || row.process_name : row.process_name}
                      </div>
                      {row.notes && <div className="text-[11px] text-slate-500 mt-0.5">{row.notes}</div>}
                    </td>
                    {activeDepartments.map((d) => {
                      const val = row.assignments[d.id] || '';
                      return (
                        <td key={d.id} className="py-2 px-1.5 text-center">
                          <select
                            disabled={!perms.can_edit || saving}
                            value={val}
                            onChange={(e) => void handleUpdateRaciCell(row, d.id, e.target.value as RaciLetter)}
                            className={`w-14 py-1 text-center font-bold border rounded-md text-xs ${
                              val === 'A'
                                ? 'bg-blue-50 border-blue-300 text-blue-800'
                                : val === 'R'
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                : val === 'C'
                                ? 'bg-amber-50 border-amber-300 text-amber-800'
                                : val === 'I'
                                ? 'bg-slate-100 border-slate-300 text-slate-700'
                                : 'bg-white border-slate-200 text-slate-400'
                            }`}
                          >
                            <option value="">—</option>
                            <option value="R">R</option>
                            <option value="A">A</option>
                            <option value="C">C</option>
                            <option value="I">I</option>
                          </select>
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          row.approval_status === 'approved' ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {formatApprovalStatusLabel(row.approval_status, lang)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        {perms.can_edit && (
                          <button
                            onClick={() => setEditingRaci({ ...row })}
                            className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-700"
                            title={lang === 'ar' ? 'تعديل' : 'Edit'}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {perms.can_approve && row.approval_status !== 'approved' && (
                          <button
                            onClick={() =>
                              void apiRequest(`/api/org/raci/${row.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ approval_status: 'approved' }),
                              }).then(() => loadWorkspace())
                            }
                            className="p-1.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800"
                            title={lang === 'ar' ? 'اعتماد' : 'Approve'}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {perms.can_delete && (
                          <button
                            onClick={() =>
                              setConfirmDelete({
                                kind: 'raci',
                                id: row.id,
                                label: lang === 'ar' ? row.process_name_ar || row.process_name : row.process_name,
                              })
                            }
                            className="p-1.5 rounded border border-red-200 hover:bg-red-50 text-red-700"
                            title={lang === 'ar' ? 'حذف' : 'Delete'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== TAB 5: RBAC, AUDIT LOG & INTEGRATION MONITOR ==================== */}
      {activeTab === 'governance' && (
        <div className="space-y-6">
          {/* RBAC Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-700" />
                {lang === 'ar'
                  ? 'مصفوفة التحكم بالصلاحيات على الخادم (RBAC)'
                  : 'Server-Enforced Role-Based Access Control (RBAC)'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ar'
                  ? 'الأدوار النظامية مستقلة تماماً عن المسميات الوظيفية، ولا تُمنح صلاحيات الإدارة تلقائياً بناءً على المسمى الوظيفي.'
                  : 'System Roles are independent from Organizational Job Titles. All checks are enforced on the Express backend.'}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 text-start font-semibold">{lang === 'ar' ? 'الدور النظامي' : 'System Role'}</th>
                    {PERMISSION_COLUMNS.map((col) => (
                      <th key={col.key} className="py-2.5 px-2 text-center font-semibold">
                        {lang === 'ar' ? col.ar : col.en}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workspace.permissions_matrix.map((roleRow) => {
                    const lockedPublic = roleRow.role_key === 'public_visitor';
                    const canToggle = perms.can_approve && !lockedPublic;
                    return (
                      <tr key={roleRow.role_key} className={lockedPublic ? 'bg-slate-50/80 text-slate-500' : ''}>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">
                            {lang === 'ar' ? roleRow.role_name_ar || roleRow.role_name : roleRow.role_name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">{roleRow.role_key}</div>
                        </td>
                        {PERMISSION_COLUMNS.map((col) => (
                          <td key={col.key} className="py-2.5 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(roleRow[col.key])}
                              disabled={!canToggle || saving}
                              onChange={() => void handleToggleRolePerm(roleRow, col.key)}
                              className="h-4 w-4 accent-blue-700 cursor-pointer disabled:cursor-not-allowed"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Staff Role Mapping (Zero PII) */}
            {perms.can_approve && userRoles.length > 0 && (
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-blue-700" />
                  {lang === 'ar'
                    ? 'تعيين الأدوار النظامية لحسابات الموظفين المصرح لهم (بدون كشف بيانات شخصية)'
                    : 'Authorized Internal Staff Role Assignments (PII-Free Account Mapping)'}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {userRoles.map((ur) => (
                    <div key={ur.user_id} className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2 text-xs">
                      <div className="font-mono text-slate-800 font-semibold">{ur.user_id}</div>
                      <div className="text-[11px] text-slate-500">
                        {lang === 'ar' ? 'حساب البوابة:' : 'Portal:'} {ur.portal_role} · {ur.portal_department}
                      </div>
                      <select
                        value={ur.org_role_key}
                        disabled={saving}
                        onChange={(e) => void handleUpdateUserOrgRole(ur.user_id, e.target.value as OrgSystemRoleKey)}
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-slate-800 text-xs"
                      >
                        {workspace.permissions_matrix
                          .filter((r) => r.role_key !== 'public_visitor')
                          .map((r) => (
                            <option key={r.role_key} value={r.role_key}>
                              {lang === 'ar' ? r.role_name_ar || r.role_name : r.role_name}
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Data Integration Monitor & Consistency Report */}
          {integration && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-700" />
                    {lang === 'ar' ? 'مراقب تكامل البيانات وفحص الاتساق' : 'Data Integration Monitor & Consistency Report'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === 'ar'
                      ? 'يتحقق مباشرة من قاعدة البيانات الفعلية ويقارن السجلات بين بوابة التوظيف والهيكل التنظيمي.'
                      : 'Inspects live SQLite persistence and verifies consistency between portal jobs, staff departments, and org nodes.'}
                  </p>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  {new Date(integration.last_checked_at).toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="font-bold text-slate-900 flex items-center justify-between">
                    <span>{lang === 'ar' ? 'قاعدة البيانات الرئيسية' : 'Primary Database Engine'}</span>
                    <span className="text-emerald-700 font-semibold">
                      {integration.database_connected ? (lang === 'ar' ? 'متصل' : 'Connected') : 'Offline'}
                    </span>
                  </div>
                  <div className="text-slate-600 mt-1 font-mono">{integration.database_engine}</div>
                  <div className="text-[11px] text-slate-500 mt-2 tabular-nums">
                    {integration.counts.portal_jobs} {lang === 'ar' ? 'وظائف بوابة' : 'portal jobs'} ·{' '}
                    {integration.counts.portal_staff_accounts} {lang === 'ar' ? 'حسابات داخلية' : 'internal accounts'}
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="font-bold text-slate-900 flex items-center justify-between">
                    <span>{lang === 'ar' ? 'تكامل Google Sheet / SheetDB' : 'Google Spreadsheet / SheetDB Feed'}</span>
                    <span
                      className={`font-semibold ${
                        integration.sheetdb_status === 'connected'
                          ? 'text-emerald-700'
                          : integration.sheetdb_status === 'error'
                          ? 'text-red-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {integration.sheetdb_status === 'not_configured'
                        ? lang === 'ar'
                          ? 'غير مفعّل'
                          : 'Not Configured'
                        : integration.sheetdb_status}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-1 leading-relaxed">{integration.sheetdb_message}</p>
                  {integration.sheetdb_counts && (
                    <div className="text-[11px] text-slate-500 mt-2 tabular-nums">
                      {integration.sheetdb_counts.departments} {lang === 'ar' ? 'إدارات' : 'depts'} ·{' '}
                      {integration.sheetdb_counts.team_structural_roles} {lang === 'ar' ? 'مناصب هيكلية (بدون PII)' : 'structural roles (PII stripped)'} ·{' '}
                      {integration.sheetdb_counts.jobs} {lang === 'ar' ? 'وظائف خارجية مرجعية' : 'external jobs'}
                    </div>
                  )}
                </div>
              </div>

              {/* Cloud Run Ephemeral SQLite Persistence Warning */}
              <div
                className={`rounded-xl border p-3.5 text-xs ${
                  integration.persistence_mode === 'ephemeral_container_disk'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="font-bold mb-0.5">
                  {lang === 'ar' ? 'حالة استمرارية قاعدة البيانات SQLite في بيئة التشغيل:' : 'Runtime SQLite Persistence Status:'}
                </div>
                <div>{lang === 'ar' ? integration.persistence_warning_ar : integration.persistence_warning}</div>
              </div>

              {/* Manual SheetDB Reconciliation Preview & Admin Sync Controls */}
              {perms.can_review && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/60">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-xs text-slate-900">
                        {lang === 'ar'
                          ? 'معاينة ومزامنة SheetDB اليدوية الآمنة (تجريد كامل للبيانات الشخصية)'
                          : 'Manual PII-Stripped SheetDB Reconciliation & Sync'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {lang === 'ar'
                          ? 'اعرض أولاً خريطة الربط والتحديثات المقترحة (معاينة جافة دون تعديل القاعدة) قبل تنفيذ أي مزامنة.'
                          : 'Run a read-only dry-run preview first to review ID mappings, status updates, and conflicts before applying any database changes.'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={previewLoading || saving}
                        onClick={() => {
                          setPreviewLoading(true);
                          setConfirmSyncOpen(false);
                          void apiRequest<OrgSheetDbSyncPreview>('/api/org/sheetdb/preview')
                            .then((res) => setSyncPreview(res))
                            .catch((err) =>
                              notify('error', err instanceof Error ? err.message : 'Preview failed')
                            )
                            .finally(() => setPreviewLoading(false));
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-lg whitespace-nowrap shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
                        {lang === 'ar' ? 'معاينة المزامنة (بدون تعديل)' : 'Preview Dry-Run Sync'}
                      </button>

                      {perms.can_approve && syncPreview && !confirmSyncOpen && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setConfirmSyncOpen(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {lang === 'ar' ? 'تنفيذ المزامنة المعتمدة' : 'Apply Approved Sync'}
                        </button>
                      )}
                    </div>
                  </div>

                  {confirmSyncOpen && syncPreview && perms.can_approve && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-blue-950">
                      <span>
                        {lang === 'ar'
                          ? 'تأكيد تنفيذ المزامنة الهيكلية؟ لن يتم المساس ببيانات التوظيف أو المرشحين أو كشف أي بيانات شخصية.'
                          : 'Confirm applying this structural reconciliation to SQLite org tables? Recruitment data and PII remain strictly untouched.'}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmSyncOpen(false)}
                          className="px-3 py-1 rounded border border-blue-200 bg-white text-slate-700 font-medium"
                        >
                          {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setSaving(true);
                            void apiRequest<{ ok: boolean; applied: OrgSheetDbSyncPreview }>('/api/org/sheetdb/sync', {
                              method: 'POST',
                            })
                              .then(async (res) => {
                                setConfirmSyncOpen(false);
                                setSyncPreview(res.applied);
                                await loadWorkspace();
                                onWorkspaceChanged?.();
                                notify(
                                  'success',
                                  lang === 'ar'
                                    ? 'تم تنفيذ المزامنة الهيكلية مع SheetDB بنجاح وتسجيلها في سجل التدقيق.'
                                    : 'SheetDB structural reconciliation synced idempotently and logged.'
                                );
                              })
                              .catch((err) =>
                                notify('error', err instanceof Error ? err.message : 'Sync failed')
                              )
                              .finally(() => setSaving(false));
                          }}
                          className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white font-medium"
                        >
                          {lang === 'ar' ? 'تأكيد التنفيذ الآن' : 'Confirm & Sync'}
                        </button>
                      </div>
                    </div>
                  )}

                  {syncPreview && (
                    <div className="space-y-3 pt-2 border-t border-slate-200 text-xs">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] tabular-nums">
                        <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                          <div className="text-slate-500">{lang === 'ar' ? 'تحديث إدارات' : 'Dept Updates'}</div>
                          <div className="font-bold text-slate-900">{syncPreview.summary.departments_update}</div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                          <div className="text-slate-500">{lang === 'ar' ? 'تحديث مناصب' : 'Position Updates'}</div>
                          <div className="font-bold text-slate-900">{syncPreview.summary.positions_update}</div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                          <div className="text-slate-500">{lang === 'ar' ? 'مناصب جديدة' : 'New Positions'}</div>
                          <div className="font-bold text-blue-800">{syncPreview.summary.positions_create}</div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                          <div className="text-slate-500">{lang === 'ar' ? 'سجلات محفوظة' : 'Preserved Local'}</div>
                          <div className="font-bold text-emerald-700">
                            {syncPreview.summary.departments_preserved + syncPreview.summary.positions_preserved}
                          </div>
                        </div>
                      </div>

                      {syncPreview.conflicts.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="font-semibold text-slate-800">
                            {lang === 'ar' ? 'تعارضات وملاحظات الهيكل:' : 'Conflicts & Structural Notes:'}
                          </div>
                          {syncPreview.conflicts.map((c) => (
                            <div key={c.id} className="bg-white border border-slate-200 rounded-lg p-2.5 text-[11px]">
                              <div className="font-semibold text-slate-900">
                                {lang === 'ar' ? c.description_ar : c.description}
                              </div>
                              <div className="text-slate-600 mt-0.5">
                                {lang === 'ar' ? c.resolution_ar : c.resolution}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                              <th className="py-2 px-2.5 text-start">{lang === 'ar' ? 'النوع' : 'Entity'}</th>
                              <th className="py-2 px-2.5 text-start">{lang === 'ar' ? 'الإجراء' : 'Action'}</th>
                              <th className="py-2 px-2.5 text-start">{lang === 'ar' ? 'المعرّف المحلي -> الخارجي' : 'Local -> External Key'}</th>
                              <th className="py-2 px-2.5 text-start">{lang === 'ar' ? 'التفاصيل والحالة' : 'Details & Transitions'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {[...syncPreview.department_changes, ...syncPreview.position_changes].map((item) => (
                              <tr key={`${item.entity_type}-${item.local_id}-${item.external_key}`}>
                                <td className="py-1.5 px-2.5 font-medium capitalize">{item.entity_type}</td>
                                <td className="py-1.5 px-2.5 font-semibold uppercase">{item.action}</td>
                                <td className="py-1.5 px-2.5 font-mono text-slate-600">
                                  {item.local_id} → {item.external_key}
                                </td>
                                <td className="py-1.5 px-2.5">
                                  <div className="font-semibold text-slate-900">
                                    {lang === 'ar' ? item.label_ar || item.label : item.label}
                                  </div>
                                  <div className="text-slate-500">{item.field_changes.join(' · ')}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* External SheetDB Jobs Reference (Read-Only, NOT auto-imported) */}
              {integration.sheetdb_jobs_reference.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-900">
                    {lang === 'ar'
                      ? 'الوظائف الخارجية المرجعية في SheetDB (للعرض فقط — غير مضافة للتوظيف أو المناصب تلقائياً)'
                      : 'External SheetDB Jobs Reference (Read-Only — Not Auto-Imported into Recruitment or Org Positions)'}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                    {integration.sheetdb_jobs_reference.map((sj) => (
                      <div key={sj.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                        <div className="font-mono text-[11px] text-slate-500">
                          {sj.id} · {sj.department_id} · {sj.status}
                        </div>
                        <div className="font-semibold text-slate-900 mt-0.5">
                          {lang === 'ar' ? sj.title_ar || sj.title : sj.title}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          {sj.department_name_ar} · {sj.location_ar} · {sj.posted_date}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Consistency Report */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-700" />
                  {lang === 'ar' ? 'تقرير الاتساق وفجوات الربط' : 'Consistency & Reconciliation Findings'}
                </h4>
                {integration.inconsistencies.length === 0 ? (
                  <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    {lang === 'ar' ? 'لا توجد تناقضات في البيانات.' : 'All structural records reconcile cleanly.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {integration.inconsistencies.map((issue) => (
                      <div
                        key={issue.id}
                        className={`rounded-lg border p-3 text-xs ${
                          issue.severity === 'warning'
                            ? 'bg-amber-50 border-amber-200 text-amber-900'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="font-semibold">{lang === 'ar' ? issue.title_ar : issue.title}</div>
                        <div className="text-[11px] opacity-85 mt-0.5">{lang === 'ar' ? issue.details_ar : issue.details}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Audit Log */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-700" />
              {lang === 'ar' ? 'سجل التدقيق التنظيمي (Audit Log)' : 'Organizational Structure Audit Log'}
            </h3>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="py-2 px-3 text-start font-semibold">{lang === 'ar' ? 'التاريخ' : 'Timestamp'}</th>
                    <th className="py-2 px-3 text-start font-semibold">{lang === 'ar' ? 'الحساب والدور' : 'Actor & Role'}</th>
                    <th className="py-2 px-3 text-start font-semibold">{lang === 'ar' ? 'الإجراء' : 'Action'}</th>
                    <th className="py-2 px-3 text-start font-semibold">{lang === 'ar' ? 'التفاصيل' : 'Details'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 px-3 text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {log.user_id} ({log.user_role})
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] font-semibold text-blue-800 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2 px-3 text-slate-700">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: LEVEL EDITOR ==================== */}
      {editingLevel && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveLevel}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900">
                {editingLevel.id
                  ? lang === 'ar'
                    ? 'تعديل المستوى التنظيمي'
                    : 'Edit Organizational Level'
                  : lang === 'ar'
                  ? 'إضافة مستوى تنظيمي'
                  : 'Add Organizational Level'}
              </h4>
              <button type="button" onClick={() => setEditingLevel(null)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'رقم المستوى' : 'Level Number'}</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  disabled={Boolean(editingLevel.id)}
                  value={editingLevel.level_number || 1}
                  onChange={(e) => setEditingLevel({ ...editingLevel, level_number: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الرمز' : 'Code'}</label>
                <input
                  type="text"
                  required
                  value={editingLevel.code || ''}
                  onChange={(e) => setEditingLevel({ ...editingLevel, code: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الاسم بالإنجليزية' : 'English Name'}</label>
                <input
                  type="text"
                  required
                  value={editingLevel.name || ''}
                  onChange={(e) => setEditingLevel({ ...editingLevel, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الاسم بالعربية' : 'Arabic Name'}</label>
                <input
                  type="text"
                  value={editingLevel.name_ar || ''}
                  onChange={(e) => setEditingLevel({ ...editingLevel, name_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الوصف بالإنجليزية' : 'English Description'}</label>
                <textarea
                  rows={2}
                  value={editingLevel.description || ''}
                  onChange={(e) => setEditingLevel({ ...editingLevel, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الوصف بالعربية' : 'Arabic Description'}</label>
                <textarea
                  rows={2}
                  value={editingLevel.description_ar || ''}
                  onChange={(e) => setEditingLevel({ ...editingLevel, description_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingLevel(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg">
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg"
              >
                {lang === 'ar' ? 'حفظ المستوى' : 'Save Level'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: DEPARTMENT EDITOR ==================== */}
      {editingDept && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDepartment}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-5 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900">
                {editingDept.id
                  ? lang === 'ar'
                    ? 'تعديل بيانات الإدارة'
                    : 'Edit Department'
                  : lang === 'ar'
                  ? 'إضافة إدارة جديدة'
                  : 'Create Department'}
              </h4>
              <button type="button" onClick={() => setEditingDept(null)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الرمز' : 'Code'}</label>
                <input
                  type="text"
                  value={editingDept.code || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, code: e.target.value })}
                  placeholder="DEP-NEW"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'حالة الاعتماد' : 'Approval Status'}</label>
                <select
                  value={editingDept.approval_status || 'proposed'}
                  onChange={(e) => setEditingDept({ ...editingDept, approval_status: e.target.value as OrgApprovalStatus })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="proposed">{lang === 'ar' ? 'مقترح (Proposed)' : 'Proposed'}</option>
                  <option value="under_review">{lang === 'ar' ? 'قيد المراجعة' : 'Under Review'}</option>
                  {perms.can_approve && <option value="approved">{lang === 'ar' ? 'معتمد (Approved)' : 'Approved'}</option>}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'اسم الإدارة بالإنجليزية *' : 'English Name *'}</label>
                <input
                  type="text"
                  required
                  value={editingDept.name || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'اسم الإدارة بالعربية' : 'Arabic Name'}</label>
                <input
                  type="text"
                  value={editingDept.name_ar || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, name_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الإدارة الأعلى' : 'Parent Department'}</label>
                <select
                  value={editingDept.parent_department_id || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, parent_department_id: e.target.value || null })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">{lang === 'ar' ? 'لا يوجد (مستوى رئيسي)' : 'None (Top Level)'}</option>
                  {workspace.departments
                    .filter((d) => d.id !== editingDept.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {lang === 'ar' ? d.name_ar || d.name : d.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'ربط قسم البوابة' : 'Mapped Portal Dept'}</label>
                <input
                  type="text"
                  value={editingDept.mapped_portal_department || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, mapped_portal_department: e.target.value })}
                  placeholder="e.g. Program Quality & Impact"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الوصف بالإنجليزية' : 'English Description'}</label>
                <textarea
                  rows={2}
                  value={editingDept.description || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الوصف بالعربية' : 'Arabic Description'}</label>
                <textarea
                  rows={2}
                  value={editingDept.description_ar || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, description_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingDept(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg">
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg">
                {lang === 'ar' ? 'حفظ الإدارة' : 'Save Department'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: FULL 17-FIELD POSITION EDITOR ==================== */}
      {editingPos && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePosition}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl p-6 space-y-4 shadow-xl max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900">
                {editingPos.id
                  ? lang === 'ar'
                    ? 'تعديل بطاقة المنصب الوظيفي (17 حقلاً)'
                    : 'Edit Position Profile (Full 17-Field Record)'
                  : lang === 'ar'
                  ? 'إنشاء منصب تنظيمي جديد (يُوسم كمقترح حتى الاعتماد)'
                  : 'Create Position (Marked Proposed Until Approved)'}
              </h4>
              <button type="button" onClick={() => setEditingPos(null)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'رمز المنصب' : 'Position Code'}</label>
                <input
                  type="text"
                  value={editingPos.code || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, code: e.target.value })}
                  placeholder="POS-NEW-001"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الإدارة *' : 'Department *'}</label>
                <select
                  required
                  value={editingPos.department_id || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, department_id: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  {activeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {lang === 'ar' ? d.name_ar || d.name : d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'المستوى التنظيمي' : 'Level'}</label>
                <select
                  value={editingPos.level_id || 'lvl-4'}
                  onChange={(e) => {
                    const lvl = workspace.levels.find((l) => l.id === e.target.value);
                    setEditingPos({
                      ...editingPos,
                      level_id: e.target.value,
                      level_number: lvl ? lvl.level_number : 4,
                    });
                  }}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  {workspace.levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {lang === 'ar' ? l.name_ar || l.name : l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'المسمى الوظيفي بالإنجليزية *' : 'English Job Title *'}</label>
                <input
                  type="text"
                  required
                  value={editingPos.title || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, title: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'عدد الشاغرين الفعلي' : 'Occupied Headcount'}</label>
                <input
                  type="number"
                  min={0}
                  value={editingPos.occupied_count ?? 0}
                  onChange={(e) => setEditingPos({ ...editingPos, occupied_count: Math.max(0, Number(e.target.value)) })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'المسمى الوظيفي بالعربية' : 'Arabic Job Title'}</label>
                <input
                  type="text"
                  value={editingPos.title_ar || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, title_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'يرفع تقاريره إلى' : 'Reports To'}</label>
                <select
                  value={editingPos.reports_to_position_id || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, reports_to_position_id: e.target.value || null })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">{lang === 'ar' ? 'لا يوجد (مستوى قيادي أعلى)' : 'None (Top Node)'}</option>
                  {workspace.positions
                    .filter((p) => p.id !== editingPos.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {lang === 'ar' ? p.title_ar || p.title : p.title}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'حالة المنصب' : 'Position Status'}</label>
                <select
                  value={editingPos.position_status || 'proposed'}
                  onChange={(e) => setEditingPos({ ...editingPos, position_status: e.target.value as OrgPositionStatus })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="proposed">{lang === 'ar' ? 'مقترح' : 'Proposed'}</option>
                  <option value="approved_vacant">{lang === 'ar' ? 'معتمد (شاغر)' : 'Approved Vacant'}</option>
                  <option value="confirmed_occupied">{lang === 'ar' ? 'معتمد ومشغول' : 'Confirmed & Occupied'}</option>
                  <option value="inactive">{lang === 'ar' ? 'غير نشط' : 'Inactive'}</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'حالة الاعتماد' : 'Approval Status'}</label>
                <select
                  value={editingPos.approval_status || 'proposed'}
                  onChange={(e) => setEditingPos({ ...editingPos, approval_status: e.target.value as OrgApprovalStatus })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="proposed">{lang === 'ar' ? 'مقترح (Proposed)' : 'Proposed'}</option>
                  <option value="under_review">{lang === 'ar' ? 'قيد المراجعة' : 'Under Review'}</option>
                  {perms.can_approve && <option value="approved">{lang === 'ar' ? 'معتمد (Approved)' : 'Approved'}</option>}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'ربط بوظيفة البوابة' : 'Link Portal Job'}</label>
                <select
                  value={editingPos.linked_job_id || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, linked_job_id: e.target.value || null })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">{lang === 'ar' ? 'غير مرتبط' : 'Unlinked'}</option>
                  {(integration?.portal_jobs_reference || []).map((j) => (
                    <option key={j.id} value={j.id}>
                      {lang === 'ar' ? j.title_ar || j.title : j.title} ({j.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الهدف الرئيسي (English)' : 'Main Objective (English)'}</label>
                <textarea
                  rows={2}
                  value={editingPos.main_objective || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, main_objective: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الهدف الرئيسي (بالعربية)' : 'Main Objective (Arabic)'}</label>
                <textarea
                  rows={2}
                  value={editingPos.main_objective_ar || ''}
                  onChange={(e) => setEditingPos({ ...editingPos, main_objective_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {lang === 'ar' ? 'المهام الرئيسية (سطر لكل مهمة)' : 'Key Tasks (one per line)'}
                  </label>
                  <textarea
                    rows={3}
                    value={(editingPos.key_tasks || []).join('\n')}
                    onChange={(e) => setEditingPos({ ...editingPos, key_tasks: e.target.value.split('\n') })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {lang === 'ar' ? 'المسؤوليات الأساسية (سطر لكل مسؤولية)' : 'Core Responsibilities (one per line)'}
                  </label>
                  <textarea
                    rows={3}
                    value={(editingPos.responsibilities || []).join('\n')}
                    onChange={(e) => setEditingPos({ ...editingPos, responsibilities: e.target.value.split('\n') })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'نطاق الصلاحية' : 'Scope of Authority'}</label>
                  <textarea
                    rows={2}
                    value={editingPos.scope_of_authority || ''}
                    onChange={(e) => setEditingPos({ ...editingPos, scope_of_authority: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'حدود اتخاذ القرار' : 'Decision-Making Boundaries'}</label>
                  <textarea
                    rows={2}
                    value={editingPos.decision_boundaries || ''}
                    onChange={(e) => setEditingPos({ ...editingPos, decision_boundaries: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {lang === 'ar' ? 'الصلاحيات الوظيفية (سطر لكل بند)' : 'Functional Permissions (one per line)'}
                  </label>
                  <textarea
                    rows={2}
                    value={(editingPos.functional_permissions || []).join('\n')}
                    onChange={(e) => setEditingPos({ ...editingPos, functional_permissions: e.target.value.split('\n') })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {lang === 'ar' ? 'التقارير المطلوبة (سطر لكل تقرير)' : 'Required Reports (one per line)'}
                  </label>
                  <textarea
                    rows={2}
                    value={(editingPos.required_reports || []).join('\n')}
                    onChange={(e) => setEditingPos({ ...editingPos, required_reports: e.target.value.split('\n') })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {lang === 'ar' ? 'مؤشرات الأداء KPIs (سطر لكل مؤشر)' : 'KPIs (one per line)'}
                  </label>
                  <textarea
                    rows={3}
                    value={(editingPos.kpis || []).join('\n')}
                    onChange={(e) => setEditingPos({ ...editingPos, kpis: e.target.value.split('\n') })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {lang === 'ar' ? 'المخرجات المتوقعة (سطر لكل مخرج)' : 'Expected Deliverables (one per line)'}
                  </label>
                  <textarea
                    rows={3}
                    value={(editingPos.expected_deliverables || []).join('\n')}
                    onChange={(e) => setEditingPos({ ...editingPos, expected_deliverables: e.target.value.split('\n') })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setEditingPos(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg">
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg">
                {lang === 'ar' ? 'حفظ بطاقة المنصب' : 'Save Position Profile'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: RELATIONSHIP EDITOR ==================== */}
      {editingRel && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveRelationship}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900">
                {editingRel.id ? (lang === 'ar' ? 'تعديل العلاقة التنظيمية' : 'Edit Relationship') : lang === 'ar' ? 'إضافة علاقة تنظيمية' : 'Add Relationship'}
              </h4>
              <button type="button" onClick={() => setEditingRel(null)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'نوع العلاقة' : 'Relationship Type'}</label>
                <select
                  disabled={Boolean(editingRel.id)}
                  value={editingRel.relationship_type || 'collaboration'}
                  onChange={(e) => setEditingRel({ ...editingRel, relationship_type: e.target.value as OrgRelationshipType })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="reporting">{lang === 'ar' ? 'تبعية رأسية (صلب)' : 'Vertical Reporting (Solid)'}</option>
                  <option value="collaboration">{lang === 'ar' ? 'تعاون أفقي (متقطع)' : 'Horizontal Collaboration (Dashed)'}</option>
                  <option value="advisory">{lang === 'ar' ? 'علاقة استشارية' : 'Advisory'}</option>
                  <option value="matrix">{lang === 'ar' ? 'علاقة مصفوفية' : 'Matrix'}</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'حالة الاعتماد' : 'Approval Status'}</label>
                <select
                  value={editingRel.approval_status || 'proposed'}
                  onChange={(e) => setEditingRel({ ...editingRel, approval_status: e.target.value as OrgApprovalStatus })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="proposed">{lang === 'ar' ? 'مقترح' : 'Proposed'}</option>
                  <option value="under_review">{lang === 'ar' ? 'قيد المراجعة' : 'Under Review'}</option>
                  {perms.can_approve && <option value="approved">{lang === 'ar' ? 'معتمد' : 'Approved'}</option>}
                </select>
              </div>

              {!editingRel.id && (
                <>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'نوع المصدر' : 'Source Entity'}</label>
                    <select
                      value={editingRel.source_type || 'department'}
                      onChange={(e) => {
                        const st = e.target.value as 'department' | 'position';
                        setEditingRel({
                          ...editingRel,
                          source_type: st,
                          source_id: st === 'department' ? activeDepartments[0]?.id || '' : workspace.positions[0]?.id || '',
                        });
                      }}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="department">{lang === 'ar' ? 'إدارة' : 'Department'}</option>
                      <option value="position">{lang === 'ar' ? 'منصب' : 'Position'}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'المصدر' : 'Source'}</label>
                    <select
                      value={editingRel.source_id || ''}
                      onChange={(e) => setEditingRel({ ...editingRel, source_id: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                    >
                      {(editingRel.source_type === 'position' ? workspace.positions : activeDepartments).map((item) => (
                        <option key={item.id} value={item.id}>
                          {'title' in item
                            ? `${lang === 'ar' ? item.title_ar || item.title : item.title} (${item.code})`
                            : lang === 'ar'
                            ? item.name_ar || item.name
                            : item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'نوع الهدف' : 'Target Entity'}</label>
                    <select
                      value={editingRel.target_type || 'department'}
                      onChange={(e) => {
                        const tt = e.target.value as 'department' | 'position';
                        setEditingRel({
                          ...editingRel,
                          target_type: tt,
                          target_id: tt === 'department' ? activeDepartments[0]?.id || '' : workspace.positions[0]?.id || '',
                        });
                      }}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="department">{lang === 'ar' ? 'إدارة' : 'Department'}</option>
                      <option value="position">{lang === 'ar' ? 'منصب' : 'Position'}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'الهدف' : 'Target'}</label>
                    <select
                      value={editingRel.target_id || ''}
                      onChange={(e) => setEditingRel({ ...editingRel, target_id: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                    >
                      {(editingRel.target_type === 'position' ? workspace.positions : activeDepartments).map((item) => (
                        <option key={item.id} value={item.id}>
                          {'title' in item
                            ? `${lang === 'ar' ? item.title_ar || item.title : item.title} (${item.code})`
                            : lang === 'ar'
                            ? item.name_ar || item.name
                            : item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'وصف العلاقة (English)' : 'Label (English)'}</label>
                <input
                  type="text"
                  value={editingRel.label || ''}
                  onChange={(e) => setEditingRel({ ...editingRel, label: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'وصف العلاقة (بالعربية)' : 'Label (Arabic)'}</label>
                <input
                  type="text"
                  value={editingRel.label_ar || ''}
                  onChange={(e) => setEditingRel({ ...editingRel, label_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'ملاحظات المراجعة' : 'Notes'}</label>
                <textarea
                  rows={2}
                  value={editingRel.notes || ''}
                  onChange={(e) => setEditingRel({ ...editingRel, notes: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingRel(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg">
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg">
                {lang === 'ar' ? 'حفظ العلاقة' : 'Save Relationship'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: RACI ROW EDITOR ==================== */}
      {editingRaci && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveRaci}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900">
                {editingRaci.id ? (lang === 'ar' ? 'تعديل صف مصفوفة RACI' : 'Edit RACI Row') : lang === 'ar' ? 'إضافة عملية إلى مصفوفة RACI' : 'Add RACI Process'}
              </h4>
              <button type="button" onClick={() => setEditingRaci(null)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'اسم العملية (English) *' : 'Process Name (English) *'}</label>
                <input
                  type="text"
                  required
                  value={editingRaci.process_name || ''}
                  onChange={(e) => setEditingRaci({ ...editingRaci, process_name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'اسم العملية (بالعربية)' : 'Process Name (Arabic)'}</label>
                <input
                  type="text"
                  value={editingRaci.process_name_ar || ''}
                  onChange={(e) => setEditingRaci({ ...editingRaci, process_name_ar: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'حالة الاعتماد' : 'Approval Status'}</label>
                <select
                  value={editingRaci.approval_status || 'proposed'}
                  onChange={(e) => setEditingRaci({ ...editingRaci, approval_status: e.target.value as OrgApprovalStatus })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="proposed">{lang === 'ar' ? 'مقترح' : 'Proposed'}</option>
                  <option value="under_review">{lang === 'ar' ? 'قيد المراجعة' : 'Under Review'}</option>
                  {perms.can_approve && <option value="approved">{lang === 'ar' ? 'معتمد' : 'Approved'}</option>}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">{lang === 'ar' ? 'ملاحظات' : 'Notes'}</label>
                <textarea
                  rows={2}
                  value={editingRaci.notes || ''}
                  onChange={(e) => setEditingRaci({ ...editingRaci, notes: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingRaci(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg">
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg">
                {lang === 'ar' ? 'حفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
