import { db, logAudit } from './db.ts';
import type {
  OrgApprovalStatus,
  OrgDepartment,
  OrgLevel,
  OrgPosition,
  OrgRaciEntry,
  OrgRelationship,
  OrgRolePermission,
  OrgSystemRoleKey,
} from '../src/types/org.ts';

export function initOrgDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_levels (
      id TEXT PRIMARY KEY,
      level_number INTEGER NOT NULL UNIQUE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      description_ar TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS org_departments (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      parent_department_id TEXT REFERENCES org_departments(id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '',
      description_ar TEXT NOT NULL DEFAULT '',
      mapped_portal_department TEXT NOT NULL DEFAULT '',
      approval_status TEXT NOT NULL DEFAULT 'proposed' CHECK(approval_status IN ('approved', 'proposed', 'under_review', 'archived')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_positions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      department_id TEXT NOT NULL REFERENCES org_departments(id) ON DELETE CASCADE,
      level_id TEXT NOT NULL REFERENCES org_levels(id),
      level_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      title_ar TEXT NOT NULL DEFAULT '',
      position_status TEXT NOT NULL DEFAULT 'proposed' CHECK(position_status IN ('confirmed_occupied', 'approved_vacant', 'proposed', 'inactive')),
      approval_status TEXT NOT NULL DEFAULT 'proposed' CHECK(approval_status IN ('approved', 'proposed', 'under_review', 'archived')),
      linked_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      occupied_count INTEGER NOT NULL DEFAULT 0,
      main_objective TEXT NOT NULL DEFAULT '',
      main_objective_ar TEXT NOT NULL DEFAULT '',
      key_tasks_json TEXT NOT NULL DEFAULT '[]',
      responsibilities_json TEXT NOT NULL DEFAULT '[]',
      scope_of_authority TEXT NOT NULL DEFAULT '',
      functional_permissions_json TEXT NOT NULL DEFAULT '[]',
      decision_boundaries TEXT NOT NULL DEFAULT '',
      required_reports_json TEXT NOT NULL DEFAULT '[]',
      kpis_json TEXT NOT NULL DEFAULT '[]',
      expected_deliverables_json TEXT NOT NULL DEFAULT '[]',
      reports_to_position_id TEXT REFERENCES org_positions(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_relationships (
      id TEXT PRIMARY KEY,
      relationship_type TEXT NOT NULL CHECK(relationship_type IN ('reporting', 'collaboration', 'advisory', 'matrix')),
      source_type TEXT NOT NULL CHECK(source_type IN ('department', 'position')),
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('department', 'position')),
      target_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      label_ar TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      approval_status TEXT NOT NULL DEFAULT 'proposed' CHECK(approval_status IN ('approved', 'proposed', 'under_review', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_raci (
      id TEXT PRIMARY KEY,
      process_name TEXT NOT NULL,
      process_name_ar TEXT NOT NULL DEFAULT '',
      department_id TEXT REFERENCES org_departments(id) ON DELETE SET NULL,
      owner_position_id TEXT REFERENCES org_positions(id) ON DELETE SET NULL,
      assignments_json TEXT NOT NULL DEFAULT '{}',
      approval_status TEXT NOT NULL DEFAULT 'proposed' CHECK(approval_status IN ('approved', 'proposed', 'under_review', 'archived')),
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_role_permissions (
      role_key TEXT PRIMARY KEY,
      role_name TEXT NOT NULL,
      role_name_ar TEXT NOT NULL DEFAULT '',
      can_view INTEGER NOT NULL DEFAULT 0,
      can_create INTEGER NOT NULL DEFAULT 0,
      can_edit INTEGER NOT NULL DEFAULT 0,
      can_delete INTEGER NOT NULL DEFAULT 0,
      can_archive INTEGER NOT NULL DEFAULT 0,
      can_review INTEGER NOT NULL DEFAULT 0,
      can_approve INTEGER NOT NULL DEFAULT 0,
      can_publish INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS org_user_roles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      org_role_key TEXT NOT NULL REFERENCES org_role_permissions(role_key),
      updated_by TEXT NOT NULL DEFAULT 'system',
      updated_at TEXT NOT NULL
    );
  `);

  ensureExternalSyncColumns();

  const levelCount = (db.prepare('SELECT COUNT(*) as cnt FROM org_levels').get() as { cnt: number }).cnt;
  if (levelCount === 0) {
    seedOrgData();
  }
}

function ensureExternalSyncColumns(): void {
  const addColumnIfMissing = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };

  addColumnIfMissing('org_departments', 'external_source', 'TEXT');
  addColumnIfMissing('org_departments', 'external_id', 'TEXT');
  addColumnIfMissing('org_positions', 'external_source', 'TEXT');
  addColumnIfMissing('org_positions', 'external_id', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_org_departments_external
      ON org_departments(external_source, external_id)
      WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_org_positions_external
      ON org_positions(external_source, external_id)
      WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
  `);
}

function seedOrgData(): void {
  const now = new Date().toISOString();

  // 1. Seed Flexible Organizational Levels 1-5
  const levels: OrgLevel[] = [
    {
      id: 'lvl-1',
      level_number: 1,
      code: 'L1',
      name: 'Executive Leadership',
      name_ar: 'القيادة التنفيذية العليا',
      description: 'Executive management and Chief Executive Officer.',
      description_ar: 'الإدارة التنفيذية والرئيس التنفيذي.',
      sort_order: 1,
    },
    {
      id: 'lvl-2',
      level_number: 2,
      code: 'L2',
      name: 'Directors, Department Heads & Advisory Offices',
      name_ar: 'المديرون ورؤوس الأقسام والمكاتب الاستشارية',
      description: 'Department directors, functional heads, and specialized advisory offices.',
      description_ar: 'مديرو الإدارات ورؤساء الأقسام والمكاتب الاستشارية المتخصصة.',
      sort_order: 2,
    },
    {
      id: 'lvl-3',
      level_number: 3,
      code: 'L3',
      name: 'Functional Units & Team Leadership',
      name_ar: 'الوحدات التخصصية وقيادة الفرق',
      description: 'Functional units, team leaders, and direct operational supervisors.',
      description_ar: 'الوحدات الوظيفية وقادة الفرق والمشرفون المباشرون.',
      sort_order: 3,
    },
    {
      id: 'lvl-4',
      level_number: 4,
      code: 'L4',
      name: 'Specialists & Professional Roles',
      name_ar: 'الأخصائيون والأدوار المهنية',
      description: 'Specialists, officers, engineers, accountants, analysts, and technical roles.',
      description_ar: 'الأخصائيون والمسؤولون والمهندسون والمحاسبون والمحللون والأدوار التقنية.',
      sort_order: 4,
    },
    {
      id: 'lvl-5',
      level_number: 5,
      code: 'L5',
      name: 'Coordinators & Operational Support',
      name_ar: 'المنسقون والدعم التشغيلي',
      description: 'Coordinators, administrative assistants, and operational support roles.',
      description_ar: 'المنسقون والمساعدون الإداريون وأدوار الدعم التشغيلي.',
      sort_order: 5,
    },
  ];

  const insertLevel = db.prepare(
    `INSERT INTO org_levels (id, level_number, code, name, name_ar, description, description_ar, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const l of levels) {
    insertLevel.run(l.id, l.level_number, l.code, l.name, l.name_ar, l.description, l.description_ar, l.sort_order);
  }

  // 2. Seed Configurable RBAC Permission Matrix
  const rolePermissions: OrgRolePermission[] = [
    {
      role_key: 'super_admin',
      role_name: 'Super Admin',
      role_name_ar: 'مدير النظام العام',
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: true,
      can_archive: true,
      can_review: true,
      can_approve: true,
      can_publish: true,
    },
    {
      role_key: 'org_admin',
      role_name: 'Organization Administrator',
      role_name_ar: 'مسؤول الهيكلة التنظيمية',
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: true,
      can_archive: true,
      can_review: true,
      can_approve: true,
      can_publish: true,
    },
    {
      role_key: 'hr_admin',
      role_name: 'HR Administrator',
      role_name_ar: 'مسؤول الموارد البشرية',
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
      can_archive: true,
      can_review: true,
      can_approve: false,
      can_publish: false,
    },
    {
      role_key: 'department_manager',
      role_name: 'Department Manager',
      role_name_ar: 'مدير القسم',
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
      can_archive: false,
      can_review: true,
      can_approve: false,
      can_publish: false,
    },
    {
      role_key: 'content_editor',
      role_name: 'Content Editor',
      role_name_ar: 'محرر البطاقات والمحتوى',
      can_view: true,
      can_create: false,
      can_edit: true,
      can_delete: false,
      can_archive: false,
      can_review: false,
      can_approve: false,
      can_publish: false,
    },
    {
      role_key: 'internal_viewer',
      role_name: 'Internal Viewer',
      role_name_ar: 'مطلع داخلي',
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_archive: false,
      can_review: false,
      can_approve: false,
      can_publish: false,
    },
    {
      role_key: 'public_visitor',
      role_name: 'Public Visitor (Restricted)',
      role_name_ar: 'زائر عام (محجوب)',
      can_view: false,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_archive: false,
      can_review: false,
      can_approve: false,
      can_publish: false,
    },
  ];

  const insertPerm = db.prepare(
    `INSERT INTO org_role_permissions (
      role_key, role_name, role_name_ar, can_view, can_create, can_edit, can_delete, can_archive, can_review, can_approve, can_publish
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rolePermissions) {
    insertPerm.run(
      r.role_key,
      r.role_name,
      r.role_name_ar,
      r.can_view ? 1 : 0,
      r.can_create ? 1 : 0,
      r.can_edit ? 1 : 0,
      r.can_delete ? 1 : 0,
      r.can_archive ? 1 : 0,
      r.can_review ? 1 : 0,
      r.can_approve ? 1 : 0,
      r.can_publish ? 1 : 0
    );
  }

  // Map existing internal portal staff to explicit system roles (never based on job title)
  const existingUsers = db.prepare('SELECT id, role FROM users').all() as Array<{ id: string; role: string }>;
  const insertUserRole = db.prepare(
    `INSERT OR IGNORE INTO org_user_roles (user_id, org_role_key, updated_by, updated_at) VALUES (?, ?, 'system', ?)`
  );
  for (const u of existingUsers) {
    let mappedRole: OrgSystemRoleKey = 'public_visitor';
    if (u.role === 'admin') mappedRole = 'super_admin';
    else if (u.role === 'assessor') mappedRole = 'internal_viewer';
    insertUserRole.run(u.id, mappedRole, now);
  }

  // 3. Seed Smart Masar Departments (Existing DB departments grounded as approved; unverified/new as proposed)
  const departments: Array<Omit<OrgDepartment, 'created_at' | 'updated_at'>> = [
    {
      id: 'dept-exec',
      code: 'DEP-EXEC',
      name: 'Executive Management',
      name_ar: 'الإدارة التنفيذية',
      parent_department_id: null,
      description: 'Executive governance, strategic direction, and organizational alignment across Smart Masar.',
      description_ar: 'القيادة التنفيذية والتوجيه الاستراتيجي والمواءمة المؤسسية لمنظومة مسار الذكي.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 1,
    },
    {
      id: 'dept-digital-advisory',
      code: 'DEP-DTA',
      name: 'Digital Transformation & Advisory',
      name_ar: 'التحول الرقمي والاستشارات',
      parent_department_id: 'dept-exec',
      description: 'Advisory office supporting digital modernization, enterprise architecture, and AI governance.',
      description_ar: 'مكتب استشاري يدعم التحول الرقمي وهندسة الأنظمة وحوكمة الذكاء الاصطناعي.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 2,
    },
    {
      id: 'dept-meal-quality',
      code: 'DEP-PQI',
      name: 'Program Quality & Impact (Programs & MEAL)',
      name_ar: 'جودة البرامج والأثر (البرامج والـ MEAL)',
      parent_department_id: 'dept-exec',
      description: 'Existing Smart Masar portal department managing MEAL frameworks, program quality, and donor accountability.',
      description_ar: 'إدارة قائمة في قاعدة بيانات البوابة تشرف على أطر المتابعة والتقييم وجودة البرامج والمساءلة.',
      mapped_portal_department: 'Program Quality & Impact',
      approval_status: 'approved',
      status: 'active',
      sort_order: 3,
    },
    {
      id: 'dept-hr',
      code: 'DEP-HR',
      name: 'Human Resources (Talent & People Operations)',
      name_ar: 'الموارد البشرية (المواهب وعمليات الأفراد)',
      parent_department_id: 'dept-exec',
      description: 'Existing portal department overseeing talent acquisition, competency frameworks, and people operations.',
      description_ar: 'إدارة قائمة في قاعدة بيانات البوابة تشرف على استقطاب الكفاءات وأطر الجدارات وعمليات الأفراد.',
      mapped_portal_department: 'Talent & People Operations',
      approval_status: 'approved',
      status: 'active',
      sort_order: 4,
    },
    {
      id: 'dept-finance',
      code: 'DEP-FIN',
      name: 'Finance & Accounting (Finance & Operations)',
      name_ar: 'المالية والمحاسبة (المالية والعمليات)',
      parent_department_id: 'dept-exec',
      description: 'Existing portal department handling budgeting, accounting controls, grants compliance, and financial reporting.',
      description_ar: 'إدارة قائمة في قاعدة بيانات البوابة مسؤولة عن الموازنات والرقابة المحاسبية والامتثال المالي.',
      mapped_portal_department: 'Finance & Operations',
      approval_status: 'approved',
      status: 'active',
      sort_order: 5,
    },
    {
      id: 'dept-training',
      code: 'DEP-IDT',
      name: 'Institutional Development & Training',
      name_ar: 'التطوير المؤسسي والتدريب',
      parent_department_id: 'dept-exec',
      description: 'Organizational capability building, competency-based training curricula, and institutional learning.',
      description_ar: 'بناء القدرات المؤسسية وبرامج التدريب المبنية على الجدارات والتعلم المؤسسي.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 6,
    },
    {
      id: 'dept-tech-ai',
      code: 'DEP-TAI',
      name: 'Technology & Artificial Intelligence',
      name_ar: 'التقنية والذكاء الاصطناعي',
      parent_department_id: 'dept-exec',
      description: 'Platform engineering, AI assessment engines, data pipelines, and cybersecurity.',
      description_ar: 'هندسة المنصات ومحركات التقييم الذكية وهندسة البيانات والأمن السيبراني.',
      mapped_portal_department: 'Data & Analytics',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 7,
    },
    {
      id: 'dept-ops-projects',
      code: 'DEP-OPS',
      name: 'Operations & Projects',
      name_ar: 'العمليات والمشاريع',
      parent_department_id: 'dept-exec',
      description: 'Project delivery lifecycle, assessment center logistics, and partner operational execution.',
      description_ar: 'إدارة دورة حياة المشاريع وتشغيل مراكز التقييم والتنفيذ الميداني والشراكات.',
      mapped_portal_department: 'Operations & Supply Chain',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 8,
    },
    {
      id: 'dept-marketing',
      code: 'DEP-MPR',
      name: 'Marketing & Public Relations',
      name_ar: 'التسويق والعلاقات العامة',
      parent_department_id: 'dept-exec',
      description: 'Employer branding, institutional communications, and outreach campaigns.',
      description_ar: 'الهوية المؤسسية والاتصال الاستراتيجي وحملات التوعية والاستقطاب.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 9,
    },
    {
      id: 'dept-biz-dev',
      code: 'DEP-BDP',
      name: 'Business Development & Partnerships',
      name_ar: 'تطوير الأعمال والشراكات',
      parent_department_id: 'dept-exec',
      description: 'Strategic alliances, institutional growth, donor relations, and partnership proposals.',
      description_ar: 'الشراكات الاستراتيجية والنمو المؤسسي وعلاقات المانحين وتطوير العروض.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 10,
    },
    {
      id: 'dept-cx',
      code: 'DEP-CXS',
      name: 'Customer Experience & Services',
      name_ar: 'تجربة المستفيدين والعملاء والخدمات',
      parent_department_id: 'dept-exec',
      description: 'Candidate and partner service excellence, feedback loops, and onboarding support.',
      description_ar: 'جودة خدمة المرشحين والشركاء وقنوات الدعم والتغذية الراجعة.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 11,
    },
    {
      id: 'dept-quality-perf',
      code: 'DEP-QPM',
      name: 'Quality & Performance',
      name_ar: 'الجودة والأداء المؤسسي',
      parent_department_id: 'dept-exec',
      description: 'KPI governance, ISO/process quality audits, and continuous performance benchmarking.',
      description_ar: 'حوكمة مؤشرات الأداء وتدقيق جودة العمليات والقياس المقارن المستمر.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 12,
    },
    {
      id: 'dept-governance',
      code: 'DEP-GVC',
      name: 'Governance & Compliance',
      name_ar: 'الحوكمة والامتثال',
      parent_department_id: 'dept-exec',
      description: 'Regulatory compliance, data privacy governance, risk controls, and ethics oversight.',
      description_ar: 'الامتثال التنظيمي وحوكمة خصوصية البيانات وإدارة المخاطر والأخلاقيات المؤسسية.',
      mapped_portal_department: '',
      approval_status: 'proposed',
      status: 'active',
      sort_order: 13,
    },
  ];

  const insertDept = db.prepare(
    `INSERT INTO org_departments (
      id, code, name, name_ar, parent_department_id, description, description_ar,
      mapped_portal_department, approval_status, status, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const d of departments) {
    insertDept.run(
      d.id,
      d.code,
      d.name,
      d.name_ar,
      d.parent_department_id,
      d.description,
      d.description_ar,
      d.mapped_portal_department,
      d.approval_status,
      d.status,
      d.sort_order,
      now,
      now
    );
  }

  // 4. Seed Organizational Positions (NO employee personal data; only verified jobs linked safely)
  const mealJobExists = Boolean(db.prepare('SELECT id FROM jobs WHERE id = ?').get('job-meal-officer'));

  const positions: Array<Omit<OrgPosition, 'created_at' | 'updated_at' | 'linked_job_title' | 'linked_job_status'>> = [
    {
      id: 'pos-ceo',
      code: 'POS-EXE-001',
      department_id: 'dept-exec',
      level_id: 'lvl-1',
      level_number: 1,
      title: 'Chief Executive Officer (CEO)',
      title_ar: 'الرئيس التنفيذي',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Provide strategic leadership, institutional governance, and executive alignment across all Smart Masar departments and impact programs.',
      main_objective_ar:
        'توجيه الرؤية الاستراتيجية والحوكمة المؤسسية وضمان التكامل بين جميع إدارات وبرامج مسار الذكي.',
      key_tasks: [
        'Approve annual strategic plans, organizational budgets, and key executive policies.',
        'Chair executive governance committees and oversee institutional performance targets.',
        'Represent Smart Masar in high-level donor, partner, and board engagements.',
      ],
      responsibilities: [
        'Accountable for organizational sustainability, governance compliance, and strategic outcomes.',
        'Final executive sign-off on approved structural expansions and executive appointments.',
      ],
      scope_of_authority: 'Organization-wide strategic, financial, and structural approval authority.',
      functional_permissions: ['Approve budgets & org structure', 'Authorize strategic partnerships', 'Chair executive reviews'],
      decision_boundaries: 'Board-mandated governance limits; operational decisions delegated to department directors.',
      required_reports: ['Quarterly Institutional Performance Scorecard', 'Annual Impact & Financial Audit Brief'],
      kpis: ['Strategic plan milestone attainment >= 90%', 'Organizational compliance audit score >= 95%'],
      expected_deliverables: ['Annual Strategic Roadmap', 'Approved Organizational Charter'],
      reports_to_position_id: null,
      sort_order: 1,
    },
    {
      id: 'pos-dta-advisor',
      code: 'POS-DTA-001',
      department_id: 'dept-digital-advisory',
      level_id: 'lvl-2',
      level_number: 2,
      title: 'Digital Transformation & AI Advisory Lead',
      title_ar: 'مستشار التحول الرقمي والذكاء الاصطناعي',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Advise executive leadership and operational departments on digital roadmap execution, assessment automation, and responsible AI adoption.',
      main_objective_ar:
        'تقديم الاستشارات للقيادة التنفيذية والإدارات حول خارطة طريق التحول الرقمي وأتمتة التقييم وتبني الذكاء الاصطناعي المسؤول.',
      key_tasks: [
        'Evaluate digital maturity across HR, MEAL, and Operations workflows.',
        'Provide non-binding technical & governance recommendations to Executive Management.',
      ],
      responsibilities: [
        'Design enterprise digital transformation blueprints and AI ethics guardrails.',
        'Review system interoperability standards across internal databases and portals.',
      ],
      scope_of_authority: 'Advisory authority across departments; no direct line-management authority over operational staff.',
      functional_permissions: ['Review architecture blueprints', 'Propose digital policies', 'Audit AI workflow fairness'],
      decision_boundaries: 'Advisory sign-off only; budget and staffing approvals remain with CEO and Department Directors.',
      required_reports: ['Bi-annual Digital Maturity Assessment', 'AI Ethics & Readiness Advisory Memo'],
      kpis: ['Digital workflow adoption rate >= 85%', 'Zero unmitigated AI governance findings'],
      expected_deliverables: ['Digital Transformation Blueprint', 'AI Governance Framework'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 2,
    },
    {
      id: 'pos-hr-director',
      code: 'POS-HR-001',
      department_id: 'dept-hr',
      level_id: 'lvl-2',
      level_number: 2,
      title: 'Director of Human Resources & Talent Operations',
      title_ar: 'مدير الموارد البشرية وعمليات المواهب',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Lead talent acquisition, competency frameworks, workforce planning, and HR governance across Smart Masar.',
      main_objective_ar:
        'قيادة استقطاب المواهب وأطر الكفاءات وتخطيط القوى العاملة وحوكمة الموارد البشرية.',
      key_tasks: [
        'Oversee competency-based recruitment campaigns and final hiring committees.',
        'Maintain approved headcount plans, job profiles, and organizational role clarity.',
      ],
      responsibilities: [
        'Ensure fair, transparent, and standardized competency assessment across all hiring.',
        'Coordinate workforce capacity planning with Department Heads.',
      ],
      scope_of_authority: 'Departmental leadership over HR workflows, hiring governance, and competency standards.',
      functional_permissions: ['Approve hiring campaigns', 'Review HR policies', 'Manage competency standards'],
      decision_boundaries: 'Headcount additions require Finance budget clearance and Executive approval.',
      required_reports: ['Monthly Recruitment Funnel & Time-to-Hire Report', 'Quarterly Workforce Readiness Report'],
      kpis: ['Time-to-fill approved vacancies <= 35 days', '100% of hires assessed via structured competency matrix'],
      expected_deliverables: ['Annual Workforce & Recruitment Plan', 'Competency Governance Policy'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 3,
    },
    {
      id: 'pos-pqi-head',
      code: 'POS-PQI-001',
      department_id: 'dept-meal-quality',
      level_id: 'lvl-2',
      level_number: 2,
      title: 'Head of Program Quality & Impact (MEAL)',
      title_ar: 'رئيس قسم جودة البرامج والأثر (MEAL)',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Direct institutional Monitoring, Evaluation, Accountability, and Learning standards across all active programs.',
      main_objective_ar:
        'قيادة معايير المتابعة والتقييم والمساءلة والتعلم عبر جميع البرامج والمشاريع.',
      key_tasks: [
        'Supervise MEAL officers and validate program LogFrames and IPTT data integrity.',
        'Ensure beneficiary accountability mechanisms (CRM/CFRM) operate to donor compliance standards.',
      ],
      responsibilities: [
        'Sign off on quarterly and annual donor impact reports.',
        'Lead after-action learning reviews and methodological audits.',
      ],
      scope_of_authority: 'Technical and supervisory authority over Program Quality & MEAL unit.',
      functional_permissions: ['Approve MEAL frameworks', 'Audit survey datasets', 'Supervise MEAL team'],
      decision_boundaries: 'Program budget reallocations require Operations and Finance concurrence.',
      required_reports: ['Quarterly Program Impact Digest', 'CRM Accountability Closure Summary'],
      kpis: ['100% donor MEAL compliance rate', '95% CRM closure within SLA'],
      expected_deliverables: ['Institutional MEAL Manual', 'Verified Impact Scorecards'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 4,
    },
    {
      id: 'pos-fin-head',
      code: 'POS-FIN-001',
      department_id: 'dept-finance',
      level_id: 'lvl-2',
      level_number: 2,
      title: 'Head of Finance & Operations Controls',
      title_ar: 'رئيس قسم المالية والرقابة التشغيلية',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Safeguard financial integrity, budgeting discipline, grant accounting, and internal procurement controls.',
      main_objective_ar:
        'حماية النزاهة المالية وانضباط الموازنات ومحاسبة المنح والرقابة الداخلية.',
      key_tasks: [
        'Lead monthly financial closes, donor financial reporting, and variance analysis.',
        'Verify budget availability prior to opening new approved positions or vendor contracts.',
      ],
      responsibilities: [
        'Maintain audit-ready ledgers and enforce financial delegation of authority limits.',
      ],
      scope_of_authority: 'Financial verification and expenditure control across approved budgets.',
      functional_permissions: ['Certify budget availability', 'Approve accounting reconciliations', 'Audit procurement compliance'],
      decision_boundaries: 'Unbudgeted allocations above threshold require CEO sign-off.',
      required_reports: ['Monthly Budget vs. Actuals Report', 'Annual External Audit Pack'],
      kpis: ['Zero material audit findings', 'Monthly close within 5 business days'],
      expected_deliverables: ['Annual Operating Budget', 'Financial Control Matrix'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 5,
    },
    {
      id: 'pos-tai-director',
      code: 'POS-TAI-001',
      department_id: 'dept-tech-ai',
      level_id: 'lvl-2',
      level_number: 2,
      title: 'Technology & AI Engineering Director',
      title_ar: 'مدير التقنية وهندسة الذكاء الاصطناعي',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Architect, secure, and scale Smart Masar software platforms, databases, and AI-enabled evaluation workflows.',
      main_objective_ar:
        'تطوير وتأمين وتشغيل منصات مسار الذكي وقواعد البيانات وتدفقات العمل المدعومة بالذكاء الاصطناعي.',
      key_tasks: [
        'Manage software engineering, database reliability, RBAC security, and API integrations.',
        'Partner with Operations and HR on platform automation and analytics dashboards.',
      ],
      responsibilities: [
        'Ensure 99.9% platform uptime, strict role-based security, and zero PII leakage.',
      ],
      scope_of_authority: 'Technical architecture, deployment, and production security governance.',
      functional_permissions: ['Approve production releases', 'Enforce security standards', 'Manage API integrations'],
      decision_boundaries: 'Data retention and privacy policies co-approved with Governance & Compliance.',
      required_reports: ['Monthly System Uptime & Security Report', 'Quarterly Engineering Velocity Brief'],
      kpis: ['Platform availability >= 99.5%', 'Critical vulnerability remediation <= 24h'],
      expected_deliverables: ['Platform Architecture & API Standards', 'Security & Backup Runbooks'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 6,
    },
    {
      id: 'pos-ops-lead',
      code: 'POS-OPS-001',
      department_id: 'dept-ops-projects',
      level_id: 'lvl-3',
      level_number: 3,
      title: 'Operations & Assessment Projects Team Lead',
      title_ar: 'قائد وحدة العمليات ومشاريع التقييم',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Coordinate operational execution, multi-stage assessment schedules, and cross-functional project delivery.',
      main_objective_ar:
        'تنسيق التنفيذ التشغيلي وجداول مراكز التقييم وتسليم المشاريع متعددة الإدارات.',
      key_tasks: [
        'Manage operational timelines across recruitment waves and client assessment projects.',
        'Resolve cross-team resource bottlenecks with HR, Tech, and Finance.',
      ],
      responsibilities: [
        'Deliver projects on schedule, within budget, and aligned with SLA quality commitments.',
      ],
      scope_of_authority: 'Operational scheduling and team-level workflow coordination.',
      functional_permissions: ['Assign operational logistics', 'Track project milestones', 'Coordinate assessors'],
      decision_boundaries: 'Contractual scope changes escalate to Department Director / Executive.',
      required_reports: ['Weekly Operations Delivery Tracker', 'Project Closure & Risk Log'],
      kpis: ['On-time milestone delivery >= 92%', 'Assessment center scheduling SLA >= 98%'],
      expected_deliverables: ['Master Operations Calendar', 'Standard Operating Procedures'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 7,
    },
    {
      id: 'pos-gov-lead',
      code: 'POS-GVC-001',
      department_id: 'dept-governance',
      level_id: 'lvl-2',
      level_number: 2,
      title: 'Governance, Risk & Compliance Officer',
      title_ar: 'مسؤول الحوكمة وإدارة المخاطر والامتثال',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Enforce institutional policies, RBAC segregation of duties, audit readiness, and personal data protection.',
      main_objective_ar:
        'إنفاذ السياسات المؤسسية وفصل الصلاحيات والجاهزية للتدقيق وحماية البيانات الشخصية.',
      key_tasks: [
        'Conduct periodic RBAC access audits and review structural approval trails.',
        'Maintain enterprise risk register and compliance checklists.',
      ],
      responsibilities: [
        'Verify privacy compliance across candidate and organizational modules.',
      ],
      scope_of_authority: 'Independent compliance inspection and audit escalation authority.',
      functional_permissions: ['Inspect audit logs', 'Flag policy non-compliance', 'Review RBAC permissions'],
      decision_boundaries: 'Advisory and compliance veto on non-compliant releases; operational fixes executed by owners.',
      required_reports: ['Quarterly Governance & RBAC Audit Report', 'Data Protection Compliance Review'],
      kpis: ['100% audit log coverage on structural changes', 'Zero unresolved high-risk privacy gaps'],
      expected_deliverables: ['Enterprise Risk Register', 'RBAC Compliance Charter'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 8,
    },
    {
      id: 'pos-meal-officer',
      code: 'POS-PQI-002',
      department_id: 'dept-meal-quality',
      level_id: 'lvl-4',
      level_number: 4,
      title: 'MEAL Officer – Monitoring, Evaluation, Accountability and Learning Officer',
      title_ar: 'مسؤول المتابعة والتقييم والمساءلة والتعلم (MEAL Officer)',
      position_status: 'approved_vacant',
      approval_status: 'approved',
      linked_job_id: mealJobExists ? 'job-meal-officer' : null,
      occupied_count: 0,
      main_objective:
        'Lead evidence-based Monitoring, Evaluation, Accountability, and Learning systems to ensure program quality, data integrity, beneficiary accountability, and donor compliance.',
      main_objective_ar:
        'قيادة أنظمة المتابعة والتقييم والمساءلة والتعلم المبنية على الأدلة لضمان جودة البرامج وسلامة البيانات ومساءلة المستفيدين والامتثال لمعايير المانحين.',
      key_tasks: [
        'Design and maintain project Logical Frameworks (LogFrames), Theory of Change, and Indicator Performance Tracking Tables (IPTT).',
        'Build, validate, and deploy digital data collection forms in KoboToolbox / ODK with strict skip logic and data quality checks.',
        'Clean, analyze, and visualize household and beneficiary survey datasets using Excel (Power Query/Pivot) and Power BI.',
        'Operate and monitor Community Feedback and Complaints Response Mechanisms (CRM/CFRM) ensuring confidential, timely closure.',
        'Draft quarterly and annual donor MEAL reports, learning briefs, and after-action review documentation.',
      ],
      responsibilities: [
        'Own field data validation, anomaly quarantining, and unbiased analytical reporting.',
        'Uphold strict beneficiary data protection and anonymized CRM case handling.',
      ],
      scope_of_authority: 'Technical authority to quarantine unverified survey records and validate IPTT figures prior to reporting.',
      functional_permissions: ['Manage KoboToolbox / ODK forms', 'Verify IPTT metrics', 'Escalate sensitive CRM cases'],
      decision_boundaries: 'Cannot alter project targets or suppress negative findings without Head of Program Quality & Impact review.',
      required_reports: ['Monthly IPTT Update', 'Post-Distribution Monitoring (PDM) Brief', 'Quarterly Donor MEAL Report'],
      kpis: [
        '100% on-time submission of verified IPTT and donor MEAL reports',
        '< 2% survey error/duplicate rate across KoboToolbox submissions',
        '95% of CRM beneficiary feedback resolved within SLA window',
      ],
      expected_deliverables: ['Verified IPTT Workbook', 'Power BI Program Impact Dashboard', 'After-Action Learning Briefs'],
      reports_to_position_id: 'pos-pqi-head',
      sort_order: 9,
    },
    {
      id: 'pos-hr-ta-spec',
      code: 'POS-HR-002',
      department_id: 'dept-hr',
      level_id: 'lvl-4',
      level_number: 4,
      title: 'Talent Acquisition & Competency Assessment Specialist',
      title_ar: 'أخصائي استقطاب المواهب وتقييم الكفاءات',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Execute competency mapping, digital assessment administration, and structured assessment center coordination.',
      main_objective_ar:
        'تنفيذ مصفوفات الكفاءات وإدارة التقييمات الرقمية وتنسيق مراكز التقييم المنظمة.',
      key_tasks: [
        'Configure job competency matrices and coordinate assessment templates with subject-matter assessors.',
        'Track applicant progression and compile structured evaluation summaries for HR committee decisions.',
      ],
      responsibilities: [
        'Ensure candidate confidentiality and objective, threshold-calibrated scoring workflows.',
      ],
      scope_of_authority: 'Operational management of assigned recruitment campaigns and assessment schedules.',
      functional_permissions: ['Manage job postings', 'Assign assessments', 'Schedule assessment centers'],
      decision_boundaries: 'Final hiring approval requires HR Director and hiring Department Head concurrence.',
      required_reports: ['Weekly Candidate Pipeline Summary', 'Assessment Completion & Pass-Rate Digest'],
      kpis: ['Candidate invitation turnaround <= 48h', '100% assessment scoring audit accuracy'],
      expected_deliverables: ['Structured Competency Rubrics', 'Shortlist Evaluation Briefs'],
      reports_to_position_id: 'pos-hr-director',
      sort_order: 10,
    },
    {
      id: 'pos-ops-coord',
      code: 'POS-OPS-002',
      department_id: 'dept-ops-projects',
      level_id: 'lvl-5',
      level_number: 5,
      title: 'Operations & Scheduling Coordinator',
      title_ar: 'منسق العمليات والجدولة',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Provide day-to-day operational logistics, interview scheduling, and administrative coordination across teams.',
      main_objective_ar:
        'تقديم الدعم التشغيلي اليومي وجدولة المقابلات والتنسيق الإداري بين الفرق.',
      key_tasks: [
        'Schedule panel interviews, assessment center logistics, and follow up on pending assessor submissions.',
        'Maintain accurate operational checklists and archival filing records.',
      ],
      responsibilities: [
        'Ensure seamless candidate and assessor scheduling experience without overlap or delays.',
      ],
      scope_of_authority: 'Administrative scheduling and logistics coordination.',
      functional_permissions: ['Update session calendars', 'Send scheduling reminders', 'Log operational checklists'],
      decision_boundaries: 'Cannot modify scoring weights, budgets, or hiring decisions.',
      required_reports: ['Daily Scheduling Readiness Checklist', 'Weekly Logistics Exception Log'],
      kpis: ['Zero double-booked assessment sessions', '100% pre-session readiness 24h in advance'],
      expected_deliverables: ['Confirmed Assessment Schedules', 'Post-Session Attendance Logs'],
      reports_to_position_id: 'pos-ops-lead',
      sort_order: 11,
    },
    {
      id: 'pos-qp-specialist',
      code: 'POS-QPM-001',
      department_id: 'dept-quality-perf',
      level_id: 'lvl-4',
      level_number: 4,
      title: 'Quality & Performance Analyst',
      title_ar: 'محلل الجودة والأداء المؤسسي',
      position_status: 'proposed',
      approval_status: 'proposed',
      linked_job_id: null,
      occupied_count: 0,
      main_objective:
        'Monitor institutional KPIs, process SLA adherence, and continuous improvement benchmarks across departments.',
      main_objective_ar:
        'متابعة مؤشرات الأداء المؤسسية والالتزام باتفاقيات مستوى الخدمة ومعايير التحسين المستمر.',
      key_tasks: [
        'Compile cross-departmental performance scorecards and root-cause bottleneck analyses.',
        'Facilitate quarterly quality review workshops with department heads.',
      ],
      responsibilities: [
        'Maintain standardized KPI definitions and verify metric integrity.',
      ],
      scope_of_authority: 'Analytical review and quality benchmarking across internal KPIs.',
      functional_permissions: ['Audit KPI inputs', 'Publish quality benchmarks'],
      decision_boundaries: 'Recommendations implemented by respective Department Managers.',
      required_reports: ['Quarterly Institutional KPI Benchmark Report'],
      kpis: ['100% KPI dashboard refresh timeliness'],
      expected_deliverables: ['Enterprise KPI Dictionary', 'Corrective Action Trackers'],
      reports_to_position_id: 'pos-ceo',
      sort_order: 12,
    },
  ];

  const insertPos = db.prepare(
    `INSERT INTO org_positions (
      id, code, department_id, level_id, level_number, title, title_ar,
      position_status, approval_status, linked_job_id, occupied_count,
      main_objective, main_objective_ar, key_tasks_json, responsibilities_json,
      scope_of_authority, functional_permissions_json, decision_boundaries,
      required_reports_json, kpis_json, expected_deliverables_json,
      reports_to_position_id, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const p of positions) {
    insertPos.run(
      p.id,
      p.code,
      p.department_id,
      p.level_id,
      p.level_number,
      p.title,
      p.title_ar,
      p.position_status,
      p.approval_status,
      p.linked_job_id,
      p.occupied_count,
      p.main_objective,
      p.main_objective_ar,
      JSON.stringify(p.key_tasks),
      JSON.stringify(p.responsibilities),
      p.scope_of_authority,
      JSON.stringify(p.functional_permissions),
      p.decision_boundaries,
      JSON.stringify(p.required_reports),
      JSON.stringify(p.kpis),
      JSON.stringify(p.expected_deliverables),
      p.reports_to_position_id,
      p.sort_order,
      now,
      now
    );
  }

  // 5. Seed Organizational Relationships (Vertical Reporting + Suggested Horizontal Collaborations + Advisory)
  const relationships: Array<{
    id: string;
    relationship_type: OrgRelationship['relationship_type'];
    source_type: 'department' | 'position';
    source_id: string;
    target_type: 'department' | 'position';
    target_id: string;
    label: string;
    label_ar: string;
    notes: string;
    approval_status: OrgApprovalStatus;
  }> = [
    // Vertical reporting links matching position hierarchy
    {
      id: 'rel-rep-1',
      relationship_type: 'reporting',
      source_type: 'position',
      source_id: 'pos-ceo',
      target_type: 'position',
      target_id: 'pos-hr-director',
      label: 'Direct Administrative Reporting',
      label_ar: 'تبعية إدارية مباشرة',
      notes: 'Executive line reporting.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-rep-2',
      relationship_type: 'reporting',
      source_type: 'position',
      source_id: 'pos-ceo',
      target_type: 'position',
      target_id: 'pos-pqi-head',
      label: 'Direct Administrative Reporting',
      label_ar: 'تبعية إدارية مباشرة',
      notes: 'Executive line reporting.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-rep-3',
      relationship_type: 'reporting',
      source_type: 'position',
      source_id: 'pos-ceo',
      target_type: 'position',
      target_id: 'pos-fin-head',
      label: 'Direct Administrative Reporting',
      label_ar: 'تبعية إدارية مباشرة',
      notes: 'Executive line reporting.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-rep-4',
      relationship_type: 'reporting',
      source_type: 'position',
      source_id: 'pos-ceo',
      target_type: 'position',
      target_id: 'pos-tai-director',
      label: 'Direct Administrative Reporting',
      label_ar: 'تبعية إدارية مباشرة',
      notes: 'Executive line reporting.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-rep-5',
      relationship_type: 'reporting',
      source_type: 'position',
      source_id: 'pos-pqi-head',
      target_type: 'position',
      target_id: 'pos-meal-officer',
      label: 'Direct Functional & Administrative Reporting',
      label_ar: 'تبعية وظيفية وإدارية مباشرة',
      notes: 'MEAL Officer reports directly to Head of Program Quality & Impact.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-rep-6',
      relationship_type: 'reporting',
      source_type: 'position',
      source_id: 'pos-hr-director',
      target_type: 'position',
      target_id: 'pos-hr-ta-spec',
      label: 'Direct Administrative Reporting',
      label_ar: 'تبعية إدارية مباشرة',
      notes: 'Talent acquisition reporting line.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-rep-7',
      relationship_type: 'reporting',
      source_type: 'position',
      source_id: 'pos-ops-lead',
      target_type: 'position',
      target_id: 'pos-ops-coord',
      label: 'Direct Operational Reporting',
      label_ar: 'تبعية تشغيلية مباشرة',
      notes: 'Operational scheduling supervision.',
      approval_status: 'proposed',
    },
    // Advisory relationships (non-managerial)
    {
      id: 'rel-adv-1',
      relationship_type: 'advisory',
      source_type: 'department',
      source_id: 'dept-digital-advisory',
      target_type: 'department',
      target_id: 'dept-exec',
      label: 'Strategic Digital & AI Advisory',
      label_ar: 'استشارات التحول الرقمي والذكاء الاصطناعي',
      notes: 'Advisory relationship without direct line authority.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-adv-2',
      relationship_type: 'advisory',
      source_type: 'department',
      source_id: 'dept-digital-advisory',
      target_type: 'department',
      target_id: 'dept-tech-ai',
      label: 'Technical Architecture Advisory',
      label_ar: 'استشارات هندسة الأنظمة والتقنية',
      notes: 'Non-managerial architectural guidance.',
      approval_status: 'proposed',
    },
    // Horizontal Collaboration Relationships (Part 4 suggested cross-department pairs — labeled Proposed)
    {
      id: 'rel-col-1',
      relationship_type: 'collaboration',
      source_type: 'department',
      source_id: 'dept-hr',
      target_type: 'department',
      target_id: 'dept-training',
      label: 'Competency Gaps & Capability Building',
      label_ar: 'فجوات الكفاءات وبناء القدرات',
      notes: 'Suggested horizontal collaboration — not confirmed official authority.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-col-2',
      relationship_type: 'collaboration',
      source_type: 'department',
      source_id: 'dept-tech-ai',
      target_type: 'department',
      target_id: 'dept-ops-projects',
      label: 'Assessment Platform & Operational Automation',
      label_ar: 'منصة التقييم وأتمتة العمليات',
      notes: 'Suggested horizontal collaboration — not confirmed official authority.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-col-3',
      relationship_type: 'collaboration',
      source_type: 'department',
      source_id: 'dept-marketing',
      target_type: 'department',
      target_id: 'dept-biz-dev',
      label: 'Outreach Campaigns & Strategic Partnerships',
      label_ar: 'حملات التوعية والشراكات الاستراتيجية',
      notes: 'Suggested horizontal collaboration — not confirmed official authority.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-col-4',
      relationship_type: 'collaboration',
      source_type: 'department',
      source_id: 'dept-finance',
      target_type: 'department',
      target_id: 'dept-ops-projects',
      label: 'Project Budgeting & Expenditure Tracking',
      label_ar: 'موازنات المشاريع وتتبع الصرف',
      notes: 'Suggested horizontal collaboration — not confirmed official authority.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-col-5',
      relationship_type: 'collaboration',
      source_type: 'department',
      source_id: 'dept-quality-perf',
      target_type: 'department',
      target_id: 'dept-meal-quality',
      label: 'KPI Alignment & Impact Benchmarking',
      label_ar: 'مواءمة مؤشرات الأداء وقياس الأثر',
      notes: 'Suggested horizontal collaboration — not confirmed official authority.',
      approval_status: 'proposed',
    },
    {
      id: 'rel-col-6',
      relationship_type: 'collaboration',
      source_type: 'department',
      source_id: 'dept-governance',
      target_type: 'department',
      target_id: 'dept-hr',
      label: 'RBAC, Privacy & Hiring Policy Compliance',
      label_ar: 'حوكمة الصلاحيات والخصوصية والامتثال الوظيفي',
      notes: 'Suggested horizontal collaboration — not confirmed official authority.',
      approval_status: 'proposed',
    },
  ];

  const insertRel = db.prepare(
    `INSERT INTO org_relationships (
      id, relationship_type, source_type, source_id, target_type, target_id,
      label, label_ar, notes, approval_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of relationships) {
    insertRel.run(
      r.id,
      r.relationship_type,
      r.source_type,
      r.source_id,
      r.target_type,
      r.target_id,
      r.label,
      r.label_ar,
      r.notes,
      r.approval_status,
      now,
      now
    );
  }

  // 6. Seed Cross-Departmental RACI Matrix (Proposed)
  const raciEntries: Array<Omit<OrgRaciEntry, 'updated_at'>> = [
    {
      id: 'raci-1',
      process_name: 'New Position Creation & Budget Approval',
      process_name_ar: 'استحداث وظيفة جديدة واعتماد موازنتها',
      department_id: 'dept-hr',
      owner_position_id: 'pos-hr-director',
      assignments: {
        'dept-exec': 'A',
        'dept-hr': 'R',
        'dept-finance': 'C',
        'dept-governance': 'C',
        'dept-ops-projects': 'I',
      },
      approval_status: 'proposed',
      notes: 'Suggested RACI governance before opening new requisitions.',
    },
    {
      id: 'raci-2',
      process_name: 'Competency Assessment & Candidate Selection',
      process_name_ar: 'تقييم الكفاءات واختيار المرشحين',
      department_id: 'dept-hr',
      owner_position_id: 'pos-hr-ta-spec',
      assignments: {
        'dept-hr': 'A',
        'dept-meal-quality': 'R',
        'dept-ops-projects': 'C',
        'dept-tech-ai': 'C',
        'dept-governance': 'I',
      },
      approval_status: 'proposed',
      notes: 'Covers multi-stage technical, SJT, behavioral, and assessment center evaluations.',
    },
    {
      id: 'raci-3',
      process_name: 'MEAL Data Integrity & Donor Reporting',
      process_name_ar: 'جودة بيانات المتابعة والتقييم وتقارير المانحين',
      department_id: 'dept-meal-quality',
      owner_position_id: 'pos-meal-officer',
      assignments: {
        'dept-meal-quality': 'R',
        'dept-exec': 'A',
        'dept-quality-perf': 'C',
        'dept-finance': 'C',
        'dept-biz-dev': 'I',
      },
      approval_status: 'proposed',
      notes: 'Quarterly and annual verified impact reporting workflow.',
    },
    {
      id: 'raci-4',
      process_name: 'Platform Security, RBAC & Data Privacy Audit',
      process_name_ar: 'تدقيق أمن المنصة والصلاحيات وخصوصية البيانات',
      department_id: 'dept-governance',
      owner_position_id: 'pos-gov-lead',
      assignments: {
        'dept-governance': 'A',
        'dept-tech-ai': 'R',
        'dept-digital-advisory': 'C',
        'dept-hr': 'C',
        'dept-exec': 'I',
      },
      approval_status: 'proposed',
      notes: 'Periodic verification that organizational records and candidate PII remain strictly segregated.',
    },
  ];

  const insertRaci = db.prepare(
    `INSERT INTO org_raci (
      id, process_name, process_name_ar, department_id, owner_position_id, assignments_json, approval_status, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const rc of raciEntries) {
    insertRaci.run(
      rc.id,
      rc.process_name,
      rc.process_name_ar,
      rc.department_id,
      rc.owner_position_id,
      JSON.stringify(rc.assignments),
      rc.approval_status,
      rc.notes,
      now
    );
  }

  logAudit({
    userId: 'system',
    userName: 'System Initializer',
    userRole: 'system',
    action: 'ORG_SEED_INITIALIZED',
    entityType: 'org_structure',
    entityId: 'smart-masar-org',
    details: 'Initialized Smart Masar Organizational Structure tables safely alongside existing portal data.',
  });
}
