import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Expand,
  GitBranch,
  Layers,
  Minimize2,
  Move,
  RotateCcw,
  Search,
  Shrink,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AppLanguage } from '../types/domain';
import type {
  OrgApprovalStatus,
  OrgDepartment,
  OrgLevel,
  OrgPosition,
  OrgPositionStatus,
  OrgRelationship,
  OrgRolePermission,
} from '../types/org';

interface OrgStructureChartProps {
  lang: AppLanguage;
  levels: OrgLevel[];
  departments: OrgDepartment[];
  positions: OrgPosition[];
  relationships: OrgRelationship[];
  permissions: OrgRolePermission;
  onEditPosition: (position: OrgPosition) => void;
}

interface PositionedNode {
  pos: OrgPosition;
  x: number;
  y: number;
  width: number;
  height: number;
  childrenCount: number;
}

const NODE_W = 248;
const NODE_H = 148;
const H_GAP = 32;
const V_GAP = 64;

export function formatPositionStatusLabel(status: OrgPositionStatus, occupiedCount: number, lang: AppLanguage): string {
  if (status === 'confirmed_occupied') {
    return lang === 'ar' ? `معتمد ومشغول (${occupiedCount})` : `Confirmed & Occupied (${occupiedCount})`;
  }
  if (status === 'approved_vacant') {
    return lang === 'ar' ? 'معتمد (شاغر)' : 'Approved Vacant';
  }
  if (status === 'inactive') {
    return lang === 'ar' ? 'غير نشط' : 'Inactive';
  }
  return lang === 'ar' ? 'مقترح' : 'Proposed';
}

export function formatApprovalStatusLabel(status: OrgApprovalStatus, lang: AppLanguage): string {
  if (status === 'approved') return lang === 'ar' ? 'معتمد' : 'Approved';
  if (status === 'under_review') return lang === 'ar' ? 'قيد المراجعة' : 'Under Review';
  if (status === 'archived') return lang === 'ar' ? 'مؤرشف' : 'Archived';
  return lang === 'ar' ? 'مقترح (غير معتمد)' : 'Proposed (Not Approved)';
}

export const OrgStructureChart: React.FC<OrgStructureChartProps> = ({
  lang,
  levels,
  departments,
  positions,
  relationships,
  permissions,
  onEditPosition,
}) => {
  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [approvalFilter, setApprovalFilter] = useState<'all' | OrgApprovalStatus>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | OrgPositionStatus>('all');
  const [layout, setLayout] = useState<'vertical' | 'horizontal'>('vertical');
  const [showOverlayEdges, setShowOverlayEdges] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  // Pan & Zoom state
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 32, y: 28 });
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const deptMap = useMemo(() => {
    const m = new Map<string, OrgDepartment>();
    departments.forEach((d) => m.set(d.id, d));
    return m;
  }, [departments]);

  const levelMap = useMemo(() => {
    const m = new Map<string, OrgLevel>();
    levels.forEach((l) => m.set(l.id, l));
    return m;
  }, [levels]);

  const posMap = useMemo(() => {
    const m = new Map<string, OrgPosition>();
    positions.forEach((p) => m.set(p.id, p));
    return m;
  }, [positions]);

  // Filter positions matching search & department scope
  const filteredPositions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const activeDepts = new Set(departments.filter((d) => d.status === 'active').map((d) => d.id));

    return positions.filter((p) => {
      if (!activeDepts.has(p.department_id)) return false;
      if (selectedDeptId !== 'all' && p.department_id !== selectedDeptId) return false;
      if (approvalFilter !== 'all' && p.approval_status !== approvalFilter) return false;
      if (statusFilter !== 'all' && p.position_status !== statusFilter) return false;
      if (q) {
        const dept = deptMap.get(p.department_id);
        const haystack = [
          p.code,
          p.title,
          p.title_ar,
          dept?.name || '',
          dept?.name_ar || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [positions, departments, selectedDeptId, approvalFilter, statusFilter, searchQuery, deptMap]);

  // Build visible tree structure
  const { positionedNodes, canvasW, canvasH, childrenByParent } = useMemo(() => {
    const visibleSet = new Set(filteredPositions.map((p) => p.id));
    const childMap = new Map<string, OrgPosition[]>();
    const roots: OrgPosition[] = [];

    for (const p of filteredPositions) {
      const parentId = p.reports_to_position_id;
      if (parentId && visibleSet.has(parentId)) {
        const arr = childMap.get(parentId) || [];
        arr.push(p);
        childMap.set(parentId, arr);
      } else {
        roots.push(p);
      }
    }

    const sortPositions = (arr: OrgPosition[]) =>
      arr.sort((a, b) => a.level_number - b.level_number || a.sort_order - b.sort_order);

    sortPositions(roots);
    childMap.forEach((arr) => sortPositions(arr));

    const nodes: PositionedNode[] = [];
    const visited = new Set<string>();

    if (layout === 'vertical') {
      const subtreeSpan = (id: string): number => {
        const children = collapsedIds.has(id) ? [] : childMap.get(id) || [];
        if (children.length === 0) return NODE_W;
        const sum = children.reduce((acc, c) => acc + subtreeSpan(c.id), 0) + H_GAP * (children.length - 1);
        return Math.max(NODE_W, sum);
      };

      const placeVertical = (pos: OrgPosition, leftX: number, depth: number) => {
        if (visited.has(pos.id)) return;
        visited.add(pos.id);
        const span = subtreeSpan(pos.id);
        const x = leftX + (span - NODE_W) / 2;
        const y = depth * (NODE_H + V_GAP);
        const rawChildren = childMap.get(pos.id) || [];

        nodes.push({ pos, x, y, width: NODE_W, height: NODE_H, childrenCount: rawChildren.length });

        if (!collapsedIds.has(pos.id) && rawChildren.length > 0) {
          const childrenWidth =
            rawChildren.reduce((acc, c) => acc + subtreeSpan(c.id), 0) + H_GAP * (rawChildren.length - 1);
          let cursorX = leftX + Math.max(0, (span - childrenWidth) / 2);
          for (const child of rawChildren) {
            const cSpan = subtreeSpan(child.id);
            placeVertical(child, cursorX, depth + 1);
            cursorX += cSpan + H_GAP;
          }
        }
      };

      let curX = 0;
      for (const root of roots) {
        const span = subtreeSpan(root.id);
        placeVertical(root, curX, 0);
        curX += span + H_GAP * 1.4;
      }
    } else {
      // Horizontal left-to-right tree layout
      const subtreeSpanV = (id: string): number => {
        const children = collapsedIds.has(id) ? [] : childMap.get(id) || [];
        if (children.length === 0) return NODE_H;
        const sum = children.reduce((acc, c) => acc + subtreeSpanV(c.id), 0) + 24 * (children.length - 1);
        return Math.max(NODE_H, sum);
      };

      const placeHorizontal = (pos: OrgPosition, topY: number, depth: number) => {
        if (visited.has(pos.id)) return;
        visited.add(pos.id);
        const span = subtreeSpanV(pos.id);
        const x = depth * (NODE_W + 76);
        const y = topY + (span - NODE_H) / 2;
        const rawChildren = childMap.get(pos.id) || [];

        nodes.push({ pos, x, y, width: NODE_W, height: NODE_H, childrenCount: rawChildren.length });

        if (!collapsedIds.has(pos.id) && rawChildren.length > 0) {
          const childrenHeight =
            rawChildren.reduce((acc, c) => acc + subtreeSpanV(c.id), 0) + 24 * (rawChildren.length - 1);
          let cursorY = topY + Math.max(0, (span - childrenHeight) / 2);
          for (const child of rawChildren) {
            const cSpan = subtreeSpanV(child.id);
            placeHorizontal(child, cursorY, depth + 1);
            cursorY += cSpan + 24;
          }
        }
      };

      let curY = 0;
      for (const root of roots) {
        const span = subtreeSpanV(root.id);
        placeHorizontal(root, curY, 0);
        curY += span + 36;
      }
    }

    const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.width), 800);
    const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.height), 480);

    return {
      positionedNodes: nodes,
      canvasW: maxX + 80,
      canvasH: maxY + 80,
      childrenByParent: childMap,
    };
  }, [filteredPositions, layout, collapsedIds]);

  const nodeLookup = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    positionedNodes.forEach((n) => m.set(n.pos.id, n));
    return m;
  }, [positionedNodes]);

  // Representative top position per department for drawing department-level collaboration / advisory dashed edges
  const deptAnchorNode = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    const sorted = [...positionedNodes].sort((a, b) => a.pos.level_number - b.pos.level_number);
    for (const n of sorted) {
      if (!m.has(n.pos.department_id)) {
        m.set(n.pos.department_id, n);
      }
    }
    return m;
  }, [positionedNodes]);

  const svgEdges = useMemo(() => {
    const lines: Array<{
      id: string;
      type: OrgRelationship['relationship_type'];
      path: string;
      label: string;
      isProposed: boolean;
    }> = [];

    // 1. Solid vertical/direct reporting edges from visible tree hierarchy
    for (const node of positionedNodes) {
      const parentId = node.pos.reports_to_position_id;
      if (!parentId) continue;
      const parent = nodeLookup.get(parentId);
      if (!parent) continue;

      if (layout === 'vertical') {
        const x1 = parent.x + parent.width / 2;
        const y1 = parent.y + parent.height;
        const x2 = node.x + node.width / 2;
        const y2 = node.y;
        const midY = (y1 + y2) / 2;
        lines.push({
          id: `tree-${parent.pos.id}-${node.pos.id}`,
          type: 'reporting',
          path: `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
          label: '',
          isProposed: node.pos.approval_status !== 'approved',
        });
      } else {
        const x1 = parent.x + parent.width;
        const y1 = parent.y + parent.height / 2;
        const x2 = node.x;
        const y2 = node.y + node.height / 2;
        const midX = (x1 + x2) / 2;
        lines.push({
          id: `tree-${parent.pos.id}-${node.pos.id}`,
          type: 'reporting',
          path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
          label: '',
          isProposed: node.pos.approval_status !== 'approved',
        });
      }
    }

    // 2. Dashed collaboration & dotted advisory/matrix overlays
    if (showOverlayEdges) {
      relationships
        .filter((r) => r.relationship_type !== 'reporting' && r.approval_status !== 'archived')
        .forEach((rel, idx) => {
          const srcNode =
            rel.source_type === 'position' ? nodeLookup.get(rel.source_id) : deptAnchorNode.get(rel.source_id);
          const tgtNode =
            rel.target_type === 'position' ? nodeLookup.get(rel.target_id) : deptAnchorNode.get(rel.target_id);
          if (!srcNode || !tgtNode || srcNode.pos.id === tgtNode.pos.id) return;

          const x1 = srcNode.x + srcNode.width / 2;
          const y1 = srcNode.y + srcNode.height / 2;
          const x2 = tgtNode.x + tgtNode.width / 2;
          const y2 = tgtNode.y + tgtNode.height / 2;
          const arcOffset = 46 + (idx % 4) * 18;
          const cx = (x1 + x2) / 2;
          const cy = Math.min(y1, y2) - arcOffset;

          lines.push({
            id: rel.id,
            type: rel.relationship_type,
            path: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
            label: lang === 'ar' ? rel.label_ar || rel.label : rel.label,
            isProposed: rel.approval_status !== 'approved',
          });
        });
    }

    return lines;
  }, [positionedNodes, nodeLookup, layout, showOverlayEdges, relationships, deptAnchorNode, lang]);

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const collapseAll = () => {
    const parentsWithKids = new Set<string>();
    childrenByParent.forEach((arr, parentId) => {
      if (arr.length > 0) parentsWithKids.add(parentId);
    });
    setCollapsedIds(parentsWithKids);
  };

  const expandAll = () => setCollapsedIds(new Set());

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, [data-node-card="true"]')) return;
    setDragging(true);
    dragOrigin.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragOrigin.current) return;
    setPan({
      x: dragOrigin.current.panX + (e.clientX - dragOrigin.current.x),
      y: dragOrigin.current.panY + (e.clientY - dragOrigin.current.y),
    });
  };

  const handlePointerUp = () => {
    setDragging(false);
    dragOrigin.current = null;
  };

  const selectedPos = selectedPositionId ? posMap.get(selectedPositionId) || null : null;
  const selectedDept = selectedPos ? deptMap.get(selectedPos.department_id) : undefined;
  const selectedLevel = selectedPos ? levelMap.get(selectedPos.level_id) : undefined;
  const managerPos = selectedPos?.reports_to_position_id ? posMap.get(selectedPos.reports_to_position_id) : undefined;
  const supervisesList = useMemo(
    () => (selectedPos ? positions.filter((p) => p.reports_to_position_id === selectedPos.id) : []),
    [selectedPos, positions]
  );
  const relatedCollabs = useMemo(() => {
    if (!selectedPos) return [];
    return relationships.filter(
      (r) =>
        r.relationship_type !== 'reporting' &&
        ((r.source_type === 'position' && r.source_id === selectedPos.id) ||
          (r.target_type === 'position' && r.target_id === selectedPos.id) ||
          (r.source_type === 'department' && r.source_id === selectedPos.department_id) ||
          (r.target_type === 'department' && r.target_id === selectedPos.department_id))
    );
  }, [selectedPos, relationships]);

  return (
    <div className="space-y-4">
      {/* Interactive Filter & Layout Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث باسم القسم أو المسمى الوظيفي...' : 'Search department or job title...'}
                className="w-full ps-9 pe-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="all">{lang === 'ar' ? 'جميع الإدارات والأقسام' : 'All Departments'}</option>
              {departments
                .filter((d) => d.status === 'active')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {lang === 'ar' ? d.name_ar || d.name : d.name}
                  </option>
                ))}
            </select>

            {permissions.can_create || permissions.can_edit || permissions.can_review || permissions.can_approve ? (
              <select
                value={approvalFilter}
                onChange={(e) => setApprovalFilter(e.target.value as 'all' | OrgApprovalStatus)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
              >
                <option value="all">{lang === 'ar' ? 'كل حالات الاعتماد' : 'All Approval States'}</option>
                <option value="approved">{lang === 'ar' ? 'معتمد فقط' : 'Approved Only'}</option>
                <option value="proposed">{lang === 'ar' ? 'مقترح فقط' : 'Proposed Only'}</option>
                <option value="under_review">{lang === 'ar' ? 'قيد المراجعة' : 'Under Review'}</option>
              </select>
            ) : (
              <span className="px-3 py-1.5 text-xs font-medium border border-emerald-200 rounded-lg bg-emerald-50 text-emerald-800 whitespace-nowrap">
                {lang === 'ar' ? 'الهيكل المعتمد رسمياً فقط' : 'Official Approved Structure Only'}
              </span>
            )}

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | OrgPositionStatus)}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="all">{lang === 'ar' ? 'كل حالات الشواغر' : 'All Position Statuses'}</option>
              <option value="confirmed_occupied">{lang === 'ar' ? 'معتمد ومشغول' : 'Confirmed & Occupied'}</option>
              <option value="approved_vacant">{lang === 'ar' ? 'معتمد (شاغر)' : 'Approved Vacant'}</option>
              <option value="proposed">{lang === 'ar' ? 'مقترح' : 'Proposed'}</option>
              <option value="inactive">{lang === 'ar' ? 'غير نشط' : 'Inactive'}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => setLayout((prev) => (prev === 'vertical' ? 'horizontal' : 'vertical'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap shrink-0"
            >
              <GitBranch className="w-3.5 h-3.5" />
              {layout === 'vertical'
                ? lang === 'ar'
                  ? 'التخطيط: عمودي'
                  : 'Layout: Vertical'
                : lang === 'ar'
                ? 'التخطيط: أفقي'
                : 'Layout: Horizontal'}
            </button>

            <button
              onClick={() => setShowOverlayEdges((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg whitespace-nowrap shrink-0 ${
                showOverlayEdges
                  ? 'border-blue-300 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'علاقات التعاون والاستشارة' : 'Collab & Advisory Lines'}
            </button>

            <button
              onClick={expandAll}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap shrink-0"
              title={lang === 'ar' ? 'توسيع الكل' : 'Expand All'}
            >
              <Expand className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'توسيع' : 'Expand'}
            </button>
            <button
              onClick={collapseAll}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap shrink-0"
              title={lang === 'ar' ? 'طي الفروع' : 'Collapse Branches'}
            >
              <Shrink className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'طي' : 'Collapse'}
            </button>

            <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
              <button
                onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))}
                className="p-1.5 hover:bg-slate-50 text-slate-700"
                title={lang === 'ar' ? 'تصغير' : 'Zoom out'}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-[11px] font-medium text-slate-700 tabular-nums border-x border-slate-200">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))))}
                className="p-1.5 hover:bg-slate-50 text-slate-700"
                title={lang === 'ar' ? 'تكبير' : 'Zoom in'}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setZoom(0.9);
                  setPan({ x: 32, y: 28 });
                }}
                className="p-1.5 hover:bg-slate-50 text-slate-700 border-s border-slate-200"
                title={lang === 'ar' ? 'إعادة ضبط العرض' : 'Reset view'}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Visual Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-5">
            <span className="inline-flex items-center gap-2">
              <svg width="28" height="8" className="shrink-0">
                <line x1="0" y1="4" x2="28" y2="4" stroke="#1d4ed8" strokeWidth="2" />
              </svg>
              {lang === 'ar' ? 'تبعية إدارية مباشرة (خط متصل)' : 'Direct Reporting (Solid Line)'}
            </span>
            <span className="inline-flex items-center gap-2">
              <svg width="28" height="8" className="shrink-0">
                <line x1="0" y1="4" x2="28" y2="4" stroke="#0891b2" strokeWidth="2" strokeDasharray="5 3" />
              </svg>
              {lang === 'ar' ? 'تعاون أفقي بين الإدارات (خط متقطع)' : 'Horizontal Collaboration (Dashed Line)'}
            </span>
            <span className="inline-flex items-center gap-2">
              <svg width="28" height="8" className="shrink-0">
                <line x1="0" y1="4" x2="28" y2="4" stroke="#7c3aed" strokeWidth="2" strokeDasharray="2 3" />
              </svg>
              {lang === 'ar' ? 'علاقة استشارية / مصفوفية' : 'Advisory / Matrix Relationship'}
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Move className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'اسحب اللوحة للتحريك · اضغط على أي بطاقة لعرض الوصف الوظيفي الكامل' : 'Drag canvas to pan · Click any card for full 17-field profile'}
          </span>
        </div>
      </div>

      {/* Pannable & Zoomable Interactive Org Chart Canvas */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        dir="ltr"
        className={`relative h-[620px] bg-slate-50 border border-slate-200 rounded-xl overflow-hidden select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        {positionedNodes.length === 0 ? (
          <div
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            className="h-full flex flex-col items-center justify-center text-sm text-slate-500 p-6 text-center"
          >
            {lang === 'ar'
              ? 'لا توجد مناصب مطابقة لخيارات البحث أو التصفية الحالية.'
              : 'No positions match your current department or search filters.'}
          </div>
        ) : (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: canvasW,
              height: canvasH,
            }}
            className="relative"
          >
            {/* Relationship Lines Layer */}
            <svg width={canvasW} height={canvasH} className="absolute inset-0 pointer-events-none">
              {svgEdges.map((edge) => {
                const stroke =
                  edge.type === 'reporting' ? '#1d4ed8' : edge.type === 'collaboration' ? '#0891b2' : '#7c3aed';
                const dash =
                  edge.type === 'reporting' ? undefined : edge.type === 'collaboration' ? '6 4' : '2 4';
                return (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={edge.type === 'reporting' ? 2 : 1.75}
                    strokeDasharray={dash}
                    strokeOpacity={edge.type === 'reporting' ? 0.85 : 0.72}
                  />
                );
              })}
            </svg>

            {/* Position Cards Layer */}
            {positionedNodes.map(({ pos, x, y, width, height, childrenCount }) => {
              const dept = deptMap.get(pos.department_id);
              const isSelected = selectedPositionId === pos.id;
              const isCollapsed = collapsedIds.has(pos.id);
              const isApproved = pos.approval_status === 'approved';

              return (
                <div
                  key={pos.id}
                  data-node-card="true"
                  dir={lang === 'ar' ? 'rtl' : 'ltr'}
                  onClick={() => setSelectedPositionId(pos.id)}
                  style={{ left: x, top: y, width, height }}
                  className={`absolute bg-white rounded-xl border p-3.5 flex flex-col justify-between transition-shadow cursor-pointer ${
                    isSelected
                      ? 'border-blue-700 ring-2 ring-blue-600/20 shadow-md'
                      : 'border-slate-200 hover:border-blue-400 shadow-xs hover:shadow-sm'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-500">
                      <span className="font-mono tabular-nums text-slate-700">
                        {pos.code} · L{pos.level_number}
                      </span>
                      <span
                        className={`font-semibold ${
                          isApproved ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {isApproved
                          ? lang === 'ar'
                            ? 'معتمد'
                            : 'Approved'
                          : lang === 'ar'
                          ? 'مقترح'
                          : 'Proposed'}
                      </span>
                    </div>

                    <div className="font-bold text-xs text-slate-900 line-clamp-2 leading-snug">
                      {lang === 'ar' ? pos.title_ar || pos.title : pos.title}
                    </div>

                    <div className="text-[11px] text-slate-600 truncate">
                      {dept ? (lang === 'ar' ? dept.name_ar || dept.name : dept.name) : pos.department_id}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-600 truncate">
                      {formatPositionStatusLabel(pos.position_status, pos.occupied_count, lang)}
                    </span>

                    {childrenCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => toggleCollapse(pos.id, e)}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium tabular-nums shrink-0"
                        title={isCollapsed ? (lang === 'ar' ? 'توسيع الفرع' : 'Expand branch') : lang === 'ar' ? 'طي الفرع' : 'Collapse branch'}
                      >
                        {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {childrenCount}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 17-Field Position Profile Slide-Over Drawer */}
      {selectedPos && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="w-full max-w-2xl bg-white h-full overflow-y-auto shadow-xl border-s border-slate-200 flex flex-col">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-mono text-slate-500">
                  {selectedPos.code} · {selectedPos.id} · L{selectedPos.level_number}
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  {lang === 'ar' ? selectedPos.title_ar || selectedPos.title : selectedPos.title}
                </h3>
                <div className="text-xs text-slate-500 mt-0.5">
                  {lang === 'ar' ? selectedPos.title : selectedPos.title_ar}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {permissions.can_edit && (
                  <button
                    onClick={() => {
                      const p = selectedPos;
                      setSelectedPositionId(null);
                      onEditPosition(p);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {lang === 'ar' ? 'تعديل البطاقة' : 'Edit Profile'}
                  </button>
                )}
                <button
                  onClick={() => setSelectedPositionId(null)}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5 text-xs text-slate-700">
              {/* Approval Clarity Disclaimer */}
              {selectedPos.approval_status !== 'approved' && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
                  <span className="font-semibold">
                    {lang === 'ar' ? 'محتوى مقترح (غير معتمد رسمياً): ' : 'Proposed Content (Not Formally Approved): '}
                  </span>
                  {lang === 'ar'
                    ? 'تم إعداد هذا الوصف الوظيفي والعلاقات كمقترح مهني استرشادي ويبقى بانتظار المراجعة والاعتماد الرسمي من الإدارة المخولة.'
                    : 'This position description and proposed links are labeled as Proposed until formally reviewed and approved by authorized administration.'}
                </div>
              )}

              {/* Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div>
                  <div className="text-slate-500">{lang === 'ar' ? 'الإدارة / القسم' : 'Department'}</div>
                  <div className="font-semibold text-slate-900 mt-0.5">
                    {selectedDept ? (lang === 'ar' ? selectedDept.name_ar || selectedDept.name : selectedDept.name) : selectedPos.department_id}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">{lang === 'ar' ? 'المستوى التنظيمي' : 'Organizational Level'}</div>
                  <div className="font-semibold text-slate-900 mt-0.5">
                    L{selectedPos.level_number} — {selectedLevel ? (lang === 'ar' ? selectedLevel.name_ar || selectedLevel.name : selectedLevel.name) : ''}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">{lang === 'ar' ? 'حالة المنصب والشغر' : 'Position Status'}</div>
                  <div className="font-semibold text-slate-900 mt-0.5">
                    {formatPositionStatusLabel(selectedPos.position_status, selectedPos.occupied_count, lang)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">{lang === 'ar' ? 'حالة الاعتماد' : 'Approval Status'}</div>
                  <div
                    className={`font-semibold mt-0.5 ${
                      selectedPos.approval_status === 'approved' ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {formatApprovalStatusLabel(selectedPos.approval_status, lang)}
                  </div>
                </div>
                {selectedPos.linked_job_id && (
                  <div className="sm:col-span-2 pt-2 border-t border-slate-200">
                    <div className="text-slate-500">{lang === 'ar' ? 'الوظيفة المرتبطة في البوابة' : 'Linked Portal Recruitment Job'}</div>
                    <div className="font-semibold text-blue-800 mt-0.5">
                      {selectedPos.linked_job_title || selectedPos.linked_job_id} ({selectedPos.linked_job_status})
                    </div>
                  </div>
                )}
              </div>

              {/* Objective */}
              <div>
                <h4 className="font-bold text-slate-900 mb-1.5">{lang === 'ar' ? 'الهدف الرئيسي للدور' : 'Main Objective'}</h4>
                <p className="leading-relaxed text-slate-700 bg-white border border-slate-200 rounded-lg p-3">
                  {lang === 'ar' ? selectedPos.main_objective_ar || selectedPos.main_objective : selectedPos.main_objective || '—'}
                </p>
              </div>

              {/* Key Tasks & Responsibilities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4">
                  <h4 className="font-bold text-slate-900 mb-2">{lang === 'ar' ? 'المهام الرئيسية' : 'Key Tasks'}</h4>
                  {selectedPos.key_tasks.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <ul className="list-disc ps-4 space-y-1.5">
                      {selectedPos.key_tasks.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border border-slate-200 rounded-xl p-4">
                  <h4 className="font-bold text-slate-900 mb-2">
                    {lang === 'ar' ? 'المسؤوليات التشغيلية والإشرافية' : 'Core Responsibilities'}
                  </h4>
                  {selectedPos.responsibilities.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <ul className="list-disc ps-4 space-y-1.5">
                      {selectedPos.responsibilities.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Authority, Permissions, Boundaries */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div>
                  <h4 className="font-bold text-slate-900">{lang === 'ar' ? 'نطاق الصلاحية والسلطة' : 'Scope of Authority'}</h4>
                  <p className="mt-1 text-slate-700">{selectedPos.scope_of_authority || '—'}</p>
                </div>
                <div>
                  <h4 className="font-bold text-slate-900">{lang === 'ar' ? 'الصلاحيات الوظيفية' : 'Functional Permissions'}</h4>
                  <p className="mt-1 text-slate-700">
                    {selectedPos.functional_permissions.length > 0 ? selectedPos.functional_permissions.join(' · ') : '—'}
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-slate-900">{lang === 'ar' ? 'حدود اتخاذ القرار' : 'Decision-Making Boundaries'}</h4>
                  <p className="mt-1 text-slate-700">{selectedPos.decision_boundaries || '—'}</p>
                </div>
              </div>

              {/* Reporting & Collaboration */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="font-bold text-slate-900 mb-1">{lang === 'ar' ? 'يرفع تقاريره إلى' : 'Reports To'}</div>
                    {managerPos ? (
                      <button
                        onClick={() => setSelectedPositionId(managerPos.id)}
                        className="text-blue-700 hover:underline font-medium text-start"
                      >
                        {lang === 'ar' ? managerPos.title_ar || managerPos.title : managerPos.title} ({managerPos.code})
                      </button>
                    ) : (
                      <span className="text-slate-500">{lang === 'ar' ? 'أعلى مستوى قيادي' : 'Top Executive Node'}</span>
                    )}
                  </div>

                  <div>
                    <div className="font-bold text-slate-900 mb-1">{lang === 'ar' ? 'يشرف على' : 'Supervises'}</div>
                    {supervisesList.length === 0 ? (
                      <span className="text-slate-500">{lang === 'ar' ? 'لا يوجد مرؤوسون مباشرون' : 'No direct reports'}</span>
                    ) : (
                      <div className="space-y-1">
                        {supervisesList.map((sub) => (
                          <button
                            key={sub.id}
                            onClick={() => setSelectedPositionId(sub.id)}
                            className="block text-blue-700 hover:underline font-medium text-start"
                          >
                            {lang === 'ar' ? sub.title_ar || sub.title : sub.title} ({sub.code})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="font-bold text-slate-900 mb-1">{lang === 'ar' ? 'يتعاون / يستشير مع' : 'Collaborates With'}</div>
                  {relatedCollabs.length === 0 ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <ul className="space-y-1">
                      {relatedCollabs.map((rc) => {
                        const otherId =
                          rc.source_id === selectedPos.id || rc.source_id === selectedPos.department_id
                            ? rc.target_id
                            : rc.source_id;
                        const otherDept = deptMap.get(otherId);
                        const otherPos = posMap.get(otherId);
                        const otherName = otherDept
                          ? lang === 'ar'
                            ? otherDept.name_ar || otherDept.name
                            : otherDept.name
                          : otherPos
                          ? lang === 'ar'
                            ? otherPos.title_ar || otherPos.title
                            : otherPos.title
                          : otherId;
                        return (
                          <li key={rc.id} className="text-slate-700">
                            <span className="font-semibold">{otherName}</span> —{' '}
                            {lang === 'ar' ? rc.label_ar || rc.label : rc.label} (
                            {formatApprovalStatusLabel(rc.approval_status, lang)})
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* Reports, KPIs & Deliverables */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="border border-slate-200 rounded-xl p-3.5">
                  <h4 className="font-bold text-slate-900 mb-2">{lang === 'ar' ? 'التقارير المطلوبة' : 'Required Reports'}</h4>
                  <ul className="list-disc ps-4 space-y-1">
                    {selectedPos.required_reports.length > 0 ? (
                      selectedPos.required_reports.map((r, i) => <li key={i}>{r}</li>)
                    ) : (
                      <li className="list-none text-slate-400">—</li>
                    )}
                  </ul>
                </div>

                <div className="border border-slate-200 rounded-xl p-3.5">
                  <h4 className="font-bold text-slate-900 mb-2">{lang === 'ar' ? 'مؤشرات الأداء (KPIs)' : 'KPIs'}</h4>
                  <ul className="list-disc ps-4 space-y-1">
                    {selectedPos.kpis.length > 0 ? (
                      selectedPos.kpis.map((k, i) => <li key={i}>{k}</li>)
                    ) : (
                      <li className="list-none text-slate-400">—</li>
                    )}
                  </ul>
                </div>

                <div className="border border-slate-200 rounded-xl p-3.5">
                  <h4 className="font-bold text-slate-900 mb-2">{lang === 'ar' ? 'المخرجات المتوقعة' : 'Expected Deliverables'}</h4>
                  <ul className="list-disc ps-4 space-y-1">
                    {selectedPos.expected_deliverables.length > 0 ? (
                      selectedPos.expected_deliverables.map((d, i) => <li key={i}>{d}</li>)
                    ) : (
                      <li className="list-none text-slate-400">—</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
