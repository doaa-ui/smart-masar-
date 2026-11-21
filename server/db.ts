import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computeCandidateScoring } from './scoring.ts';
import type {
  AssessmentItem,
  AssessmentWeights,
  AssessorEvaluation,
  CandidateAnswerRecord,
  Competency,
  UserRole,
} from '../src/types/domain.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'cvs');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'smart_masar.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  const keyBuf = Buffer.from(key, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}-${Date.now().toString(36)}`;
}

export function logAudit(params: {
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, user_name, user_role, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateId('aud'),
    params.userId,
    params.userName,
    params.userRole,
    params.action,
    params.entityType,
    params.entityId,
    params.details,
    new Date().toISOString()
  );
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'assessor', 'candidate')),
      department TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_settings (
      id TEXT PRIMARY KEY,
      org_name TEXT NOT NULL,
      org_name_ar TEXT NOT NULL,
      tagline TEXT NOT NULL,
      tagline_ar TEXT NOT NULL,
      logo_url TEXT NOT NULL,
      default_language TEXT NOT NULL DEFAULT 'ar',
      job_categories_json TEXT NOT NULL,
      competency_categories_json TEXT NOT NULL,
      scoring_scale_max INTEGER NOT NULL DEFAULT 100,
      passing_threshold_default INTEGER NOT NULL DEFAULT 70,
      default_assessment_weights_json TEXT NOT NULL,
      workflow_stages_json TEXT NOT NULL,
      retention_days INTEGER NOT NULL DEFAULT 365,
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_ar TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      title TEXT NOT NULL,
      title_ar TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL,
      department_ar TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Programs & MEAL',
      purpose TEXT NOT NULL DEFAULT '',
      purpose_ar TEXT NOT NULL DEFAULT '',
      responsibilities_json TEXT NOT NULL DEFAULT '[]',
      qualifications_json TEXT NOT NULL DEFAULT '[]',
      experience_req TEXT NOT NULL DEFAULT '',
      technical_skills_json TEXT NOT NULL DEFAULT '[]',
      behavioral_skills_json TEXT NOT NULL DEFAULT '[]',
      preferred_qualifications_json TEXT NOT NULL DEFAULT '[]',
      employment_type TEXT NOT NULL DEFAULT 'Full-time',
      location TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      vacancies_count INTEGER NOT NULL DEFAULT 1,
      raw_jd_text TEXT NOT NULL DEFAULT '',
      ai_analysis_json TEXT,
      ai_analysis_status TEXT NOT NULL DEFAULT 'none',
      status TEXT NOT NULL DEFAULT 'draft',
      workflow_stages_json TEXT NOT NULL DEFAULT '[]',
      assessment_weights_json TEXT NOT NULL,
      passing_threshold INTEGER NOT NULL DEFAULT 70,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS competencies (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      description_ar TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL CHECK(category IN ('Technical', 'Behavioral')),
      importance TEXT NOT NULL DEFAULT 'High',
      is_critical INTEGER NOT NULL DEFAULT 0,
      weight REAL NOT NULL,
      assessment_method TEXT NOT NULL DEFAULT '',
      expected_level TEXT NOT NULL DEFAULT 'Proficient',
      min_threshold REAL NOT NULL DEFAULT 60,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS assessment_templates (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      title_ar TEXT NOT NULL DEFAULT '',
      is_reusable_template INTEGER NOT NULL DEFAULT 0,
      approval_status TEXT NOT NULL DEFAULT 'draft',
      approved_by TEXT,
      approved_at TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 90,
      open_date TEXT NOT NULL DEFAULT '',
      close_date TEXT NOT NULL DEFAULT '',
      max_attempts INTEGER NOT NULL DEFAULT 1,
      allow_resume INTEGER NOT NULL DEFAULT 1,
      randomize_questions INTEGER NOT NULL DEFAULT 0,
      show_results_to_candidate INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessment_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES assessment_templates(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      section_type TEXT NOT NULL CHECK(section_type IN ('technical', 'sjt', 'behavioral', 'practical')),
      question_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      prompt_ar TEXT NOT NULL DEFAULT '',
      scenario_context TEXT NOT NULL DEFAULT '',
      scenario_context_ar TEXT NOT NULL DEFAULT '',
      options_json TEXT NOT NULL DEFAULT '[]',
      correct_answer TEXT NOT NULL DEFAULT '',
      marking_guide TEXT NOT NULL DEFAULT '',
      marking_guide_ar TEXT NOT NULL DEFAULT '',
      competency_id TEXT NOT NULL DEFAULT '',
      max_score REAL NOT NULL DEFAULT 10,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      explanation TEXT NOT NULL DEFAULT '',
      resources_json TEXT NOT NULL DEFAULT '[]',
      expected_output TEXT NOT NULL DEFAULT '',
      rubric_json TEXT NOT NULL DEFAULT '[]',
      time_limit_minutes INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      candidate_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      cv_filename TEXT,
      cv_original_name TEXT,
      cv_mime TEXT,
      cv_text_summary TEXT NOT NULL DEFAULT '',
      consent_accepted INTEGER NOT NULL DEFAULT 1,
      consent_at TEXT,
      is_sample_demo INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      application_code TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'applied',
      current_stage TEXT NOT NULL DEFAULT 'Application',
      invite_token TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL,
      final_recommendation TEXT NOT NULL DEFAULT 'pending',
      human_decision TEXT NOT NULL DEFAULT 'pending',
      decision_notes TEXT NOT NULL DEFAULT '',
      decision_by TEXT,
      decision_at TEXT
    );

    CREATE TABLE IF NOT EXISTS assessment_assignments (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL REFERENCES assessment_templates(id),
      job_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'assigned',
      attempts_allowed INTEGER NOT NULL DEFAULT 1,
      due_date TEXT NOT NULL DEFAULT '',
      assigned_by TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessment_attempts (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assessment_assignments(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'in_progress',
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      answers_json TEXT NOT NULL DEFAULT '{}',
      practical_submission_text TEXT NOT NULL DEFAULT '',
      practical_attachment_name TEXT,
      section_scores_json TEXT NOT NULL DEFAULT '{}',
      competency_scores_json TEXT NOT NULL DEFAULT '[]',
      overall_score REAL NOT NULL DEFAULT 0,
      threshold_passed INTEGER NOT NULL DEFAULT 0,
      critical_passed INTEGER NOT NULL DEFAULT 0,
      evaluation_category TEXT NOT NULL DEFAULT 'pending',
      strengths_json TEXT NOT NULL DEFAULT '[]',
      improvement_areas_json TEXT NOT NULL DEFAULT '[]',
      threshold_failures_json TEXT NOT NULL DEFAULT '[]',
      evaluator_notes TEXT NOT NULL DEFAULT '',
      evaluated_by TEXT,
      evaluated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS assessment_center_configs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL DEFAULT '',
      purpose_ar TEXT NOT NULL DEFAULT '',
      activities_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS assessment_center_schedules (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      activity_name TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'online',
      scheduled_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 45,
      location_or_link TEXT NOT NULL DEFAULT '',
      assessor_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessor_evaluations (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES assessment_center_schedules(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      assessor_id TEXT NOT NULL REFERENCES users(id),
      observations TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      competency_ratings_json TEXT NOT NULL DEFAULT '{}',
      overall_rating REAL NOT NULL DEFAULT 0,
      comments TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_reports (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      ai_summary TEXT NOT NULL DEFAULT '',
      strengths_json TEXT NOT NULL DEFAULT '[]',
      improvement_areas_json TEXT NOT NULL DEFAULT '[]',
      human_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  const orgCount = (db.prepare('SELECT COUNT(*) as cnt FROM organization_settings').get() as { cnt: number }).cnt;
  if (orgCount === 0) {
    seedInitialData();
  }
}

function seedInitialData(): void {
  const now = new Date().toISOString();

  // 1. Seed Organization Settings
  const defaultWeights: AssessmentWeights = {
    technical: 30,
    sjt: 20,
    behavioral: 15,
    practical: 20,
    center: 15,
  };
  const workflowStages = [
    'Application',
    'Screening',
    'Technical Test',
    'SJT',
    'Behavioral Assessment',
    'Practical Task',
    'Assessment Center',
    'Final Review',
  ];

  db.prepare(
    `INSERT INTO organization_settings (
      id, org_name, org_name_ar, tagline, tagline_ar, logo_url, default_language,
      job_categories_json, competency_categories_json, scoring_scale_max, passing_threshold_default,
      default_assessment_weights_json, workflow_stages_json, retention_days, notifications_enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'org-default',
    'Smart Masar',
    'مسار الذكي',
    'Connecting Talent with the Right Opportunities.',
    'ربط المواهب بالفرص المناسبة.',
    '/assets/aistudio/WhatsApp_Image_2026-11-13_at_2.17.28_PM_9e3418f5.jpeg',
    'ar',
    JSON.stringify(['Programs & MEAL', 'Finance & Accounting', 'Human Resources', 'Operations & Supply Chain', 'Data & Analytics']),
    JSON.stringify(['Technical', 'Behavioral']),
    100,
    70,
    JSON.stringify(defaultWeights),
    JSON.stringify(workflowStages),
    365,
    1,
    now
  );

  // 2. Seed Users (Admin, Assessors, Demo Candidate)
  const users: Array<{
    id: string;
    name: string;
    name_ar: string;
    email: string;
    password: string;
    role: UserRole;
    department: string;
  }> = [
    {
      id: 'usr-admin-1',
      name: 'Dr. Layla Al-Mansoor',
      name_ar: 'د. ليلى المنصور',
      email: 'admin@smartmasar.org',
      password: 'Admin@2026',
      role: 'admin',
      department: 'Talent & People Operations',
    },
    {
      id: 'usr-assessor-1',
      name: 'Tariq Al-Zahrani',
      name_ar: 'طارق الزهراني',
      email: 'assessor@smartmasar.org',
      password: 'Assessor@2026',
      role: 'assessor',
      department: 'Monitoring, Evaluation & Learning',
    },
    {
      id: 'usr-assessor-2',
      name: 'Nadia Haddad',
      name_ar: 'نادية حداد',
      email: 'finance.assessor@smartmasar.org',
      password: 'Assessor@2026',
      role: 'assessor',
      department: 'Finance & Operations',
    },
    {
      id: 'usr-cand-1',
      name: 'Sara Al-Khatib (Sample Candidate)',
      name_ar: 'سارة الخطيب (مرشحة تجريبية)',
      email: 'sara.demo@example.org',
      password: 'Candidate@2026',
      role: 'candidate',
      department: 'Candidate',
    },
  ];

  const insertUser = db.prepare(
    `INSERT INTO users (id, name, name_ar, email, password_hash, role, department, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  for (const u of users) {
    insertUser.run(u.id, u.name, u.name_ar, u.email, hashPassword(u.password), u.role, u.department, now);
  }

  // 3. Seed Recruitment Campaign
  const campaignId = 'camp-2026-q4';
  db.prepare(
    `INSERT INTO campaigns (id, title, title_ar, description, status, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    campaignId,
    '2026 Q4 Regional Impact & Operations Recruitment Drive',
    'حملة استقطاب كفاءات الأثر والعمليات الإقليمية - الربع الرابع 2026',
    'Multi-role talent acquisition campaign with competency-mapped digital assessments and structured assessment centers.',
    'active',
    '2026-10-01',
    '2026-12-31',
    now
  );

  // 4. Seed Sample Job 1: MEAL Officer
  const mealJobId = 'job-meal-officer';
  const mealResponsibilities = [
    'Design and maintain project Logical Frameworks (LogFrames), Theory of Change, and Indicator Performance Tracking Tables (IPTT).',
    'Build, validate, and deploy digital data collection forms in KoboToolbox / ODK with strict skip logic and data quality checks.',
    'Clean, analyze, and visualize household and beneficiary survey datasets using Excel (Power Query/Pivot) and Power BI.',
    'Operate and monitor Community Feedback and Complaints Response Mechanisms (CRM/CFRM) ensuring confidential, timely closure.',
    'Draft quarterly and annual donor MEAL reports, learning briefs, and after-action review documentation.',
  ];
  const mealQualifications = [
    "Bachelor's degree in Statistics, Economics, Social Sciences, International Development, or related quantitative discipline.",
    'Minimum 3 years of progressive field and analytical experience in Monitoring, Evaluation, Accountability, and Learning (MEAL).',
    'Demonstrated proficiency in KoboToolbox / ODK, Advanced Microsoft Excel, and Power BI.',
    'Fluency in Arabic and professional working proficiency in English.',
  ];
  const mealAnalysis = {
    purpose:
      'Lead evidence-based Monitoring, Evaluation, Accountability, and Learning systems to ensure program quality, data integrity, beneficiary accountability, and donor compliance.',
    purpose_ar:
      'قيادة أنظمة المتابعة والتقييم والمساءلة والتعلم المبنية على الأدلة لضمان جودة البرامج وسلامة البيانات ومساءلة المستفيدين والامتثال لمعايير المانحين.',
    responsibilities: mealResponsibilities,
    qualifications: mealQualifications,
    experience_req: '3–5 years in humanitarian or development MEAL operations.',
    technical_competencies: [],
    behavioral_competencies: [],
    performance_indicators: [
      '100% on-time submission of verified IPTT and donor MEAL reports',
      '< 2% survey error/duplicate rate across KoboToolbox submissions',
      '95% of CRM beneficiary feedback resolved within SLA window',
    ],
    recommended_assessment_methods: [
      'Technical Knowledge Test (LogFrames, Kobo/ODK, Excel/Power BI)',
      'Situational Judgment Test (Field ethics & data discrepancies)',
      'Practical Data Cleaning & Indicator Analysis Work Sample',
      'Assessment Center Structured Interview & Case Study',
    ],
  };

  db.prepare(
    `INSERT INTO jobs (
      id, campaign_id, title, title_ar, department, department_ar, category,
      purpose, purpose_ar, responsibilities_json, qualifications_json, experience_req,
      technical_skills_json, behavioral_skills_json, preferred_qualifications_json,
      employment_type, location, deadline, vacancies_count, raw_jd_text,
      ai_analysis_json, ai_analysis_status, status, workflow_stages_json,
      assessment_weights_json, passing_threshold, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mealJobId,
    campaignId,
    'MEAL Officer – Monitoring, Evaluation, Accountability and Learning Officer',
    'مسؤول المتابعة والتقييم والمساءلة والتعلم (MEAL Officer)',
    'Program Quality & Impact',
    'جودة البرامج والأثر',
    'Programs & MEAL',
    mealAnalysis.purpose,
    mealAnalysis.purpose_ar,
    JSON.stringify(mealResponsibilities),
    JSON.stringify(mealQualifications),
    '3–5 years in MEAL systems, quantitative survey design, and donor reporting',
    JSON.stringify(['LogFrame & IPTT', 'KoboToolbox / ODK', 'Excel & Power BI', 'CRM / CFRM', 'Donor Reporting']),
    JSON.stringify(['Integrity & Ethics', 'Analytical Thinking', 'Field Facilitation', 'Adaptability', 'Teamwork']),
    JSON.stringify(['Experience with USAID/ECHO/UN MEAL standards', 'Power BI DAX certification']),
    'Full-time',
    'Amman / Regional Hybrid',
    '2026-12-20',
    2,
    'We are seeking an experienced MEAL Officer to lead monitoring frameworks, KoboToolbox data quality assurance, Excel/Power BI analytics, beneficiary accountability mechanisms, and donor learning documentation.',
    JSON.stringify(mealAnalysis),
    'approved',
    'published',
    JSON.stringify(workflowStages),
    JSON.stringify(defaultWeights),
    70,
    'usr-admin-1',
    now,
    now
  );

  // 5. Seed Exact 10 Competencies for MEAL Officer (Total = 100%)
  const mealCompetencies: Array<{
    id: string;
    name: string;
    name_ar: string;
    description: string;
    description_ar: string;
    category: 'Technical' | 'Behavioral';
    importance: 'Critical' | 'High' | 'Medium';
    is_critical: number;
    weight: number;
    assessment_method: string;
    expected_level: string;
    min_threshold: number;
  }> = [
    {
      id: 'comp-meal-1',
      name: 'MEAL frameworks and indicators',
      name_ar: 'أطر المتابعة والتقييم والمؤشرات',
      description: 'Ability to design LogFrames, Theory of Change, SMART indicators, and IPTT tracking.',
      description_ar: 'القدرة على تصميم الإطار المنطقي ونظرية التغيير والمؤشرات الذكية وتتبع الأداء.',
      category: 'Technical',
      importance: 'Critical',
      is_critical: 1,
      weight: 15,
      assessment_method: 'Technical Test & Case Study',
      expected_level: 'Advanced',
      min_threshold: 70,
    },
    {
      id: 'comp-meal-2',
      name: 'KoboToolbox / ODK and data quality',
      name_ar: 'أدوات KoboToolbox / ODK وجودة البيانات',
      description: 'XLSForm validation constraints, skip logic, audit checks, and data cleaning protocols.',
      description_ar: 'بناء الاستمارات الرقمية وقواعد التحقق من جودة البيانات وتنظيفها.',
      category: 'Technical',
      importance: 'Critical',
      is_critical: 1,
      weight: 15,
      assessment_method: 'Technical Test & Practical Task',
      expected_level: 'Advanced',
      min_threshold: 70,
    },
    {
      id: 'comp-meal-3',
      name: 'Excel and Power BI data analysis',
      name_ar: 'تحليل البيانات عبر Excel و Power BI',
      description: 'Pivot tables, Power Query, DAX measures, indicator disaggregation, and visual dashboards.',
      description_ar: 'الجداول المحورية وPower Query ولوحات المؤشرات التفاعلية.',
      category: 'Technical',
      importance: 'High',
      is_critical: 0,
      weight: 12,
      assessment_method: 'Practical Work Sample',
      expected_level: 'Proficient',
      min_threshold: 60,
    },
    {
      id: 'comp-meal-4',
      name: 'Accountability and complaints mechanisms',
      name_ar: 'المساءلة وآليات الشكاوى والتغذية الراجعة',
      description: 'Managing safe, confidential beneficiary feedback channels and closing accountability loops.',
      description_ar: 'إدارة قنوات شكاوى المستفيدين بسرية ومهنية وإغلاق حلقة المساءلة.',
      category: 'Technical',
      importance: 'High',
      is_critical: 0,
      weight: 10,
      assessment_method: 'SJT & Structured Interview',
      expected_level: 'Proficient',
      min_threshold: 65,
    },
    {
      id: 'comp-meal-5',
      name: 'Documentation, learning, and donor reporting',
      name_ar: 'التوثيق والتعلم وإعداد تقارير المانحين',
      description: 'Synthesizing field evidence into actionable learning briefs and compliant donor reports.',
      description_ar: 'صياغة تقارير المانحين وموجزات التعلم المبنية على الأدلة.',
      category: 'Technical',
      importance: 'High',
      is_critical: 0,
      weight: 8,
      assessment_method: 'Practical Task & Short Answer',
      expected_level: 'Proficient',
      min_threshold: 60,
    },
    {
      id: 'comp-meal-6',
      name: 'Integrity, neutrality, and professional ethics',
      name_ar: 'النزاهة والحيادية والأخلاقيات المهنية',
      description: 'Upholding unbiased data reporting, safeguarding confidentiality, and resisting data manipulation.',
      description_ar: 'الالتزام بالحياد في تقارير البيانات وحماية سرية المستفيدين.',
      category: 'Behavioral',
      importance: 'Critical',
      is_critical: 1,
      weight: 10,
      assessment_method: 'SJT & Behavioral Assessment',
      expected_level: 'Advanced',
      min_threshold: 75,
    },
    {
      id: 'comp-meal-7',
      name: 'Analytical thinking',
      name_ar: 'التفكير التحليلي',
      description: 'Identifying root causes, anomalies, and meaningful patterns across complex datasets.',
      description_ar: 'تحليل الأنماط والشذوذات الإحصائية واستخلاص الأسباب الجذرية.',
      category: 'Behavioral',
      importance: 'High',
      is_critical: 0,
      weight: 8,
      assessment_method: 'Practical Task & Behavioral',
      expected_level: 'Proficient',
      min_threshold: 60,
    },
    {
      id: 'comp-meal-8',
      name: 'Field communication, facilitation, and listening',
      name_ar: 'التواصل الميداني والتيسير والاستماع الفعال',
      description: 'Facilitating focus group discussions and active listening with diverse communities.',
      description_ar: 'تيسير مجموعات النقاش المركزة والتواصل البناء مع المجتمعات.',
      category: 'Behavioral',
      importance: 'High',
      is_critical: 0,
      weight: 8,
      assessment_method: 'Assessment Center & Behavioral',
      expected_level: 'Proficient',
      min_threshold: 60,
    },
    {
      id: 'comp-meal-9',
      name: 'Adaptability, cultural sensitivity, and working under pressure',
      name_ar: 'المرونة والحساسية الثقافية والعمل تحت الضغط',
      description: 'Maintaining analytical rigor and composure during rapid emergency shifts and tight deadlines.',
      description_ar: 'الحفاظ على الدقة والهدوء أثناء الطوارئ وضغط المواعيد النهائية.',
      category: 'Behavioral',
      importance: 'Medium',
      is_critical: 0,
      weight: 7,
      assessment_method: 'SJT & Behavioral Assessment',
      expected_level: 'Proficient',
      min_threshold: 55,
    },
    {
      id: 'comp-meal-10',
      name: 'Coordination, teamwork, and relationship management',
      name_ar: 'التنسيق والعمل الجماعي وإدارة العلاقات',
      description: 'Collaborating constructively with program, field, and partner teams to drive data utilization.',
      description_ar: 'التنسيق الفعال مع فرق البرامج والشركاء لتعزيز استخدام البيانات.',
      category: 'Behavioral',
      importance: 'Medium',
      is_critical: 0,
      weight: 7,
      assessment_method: 'SJT & Assessment Center',
      expected_level: 'Proficient',
      min_threshold: 55,
    },
  ];

  const insertComp = db.prepare(
    `INSERT INTO competencies (
      id, job_id, name, name_ar, description, description_ar, category,
      importance, is_critical, weight, assessment_method, expected_level, min_threshold, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  mealCompetencies.forEach((c, idx) => {
    insertComp.run(
      c.id,
      mealJobId,
      c.name,
      c.name_ar,
      c.description,
      c.description_ar,
      c.category,
      c.importance,
      c.is_critical,
      c.weight,
      c.assessment_method,
      c.expected_level,
      c.min_threshold,
      idx + 1
    );
  });

  // 6. Seed Approved Assessment Template + 12 Items across all 4 Assessment Types for MEAL Officer
  const templateId = 'tpl-meal-2026';
  db.prepare(
    `INSERT INTO assessment_templates (
      id, job_id, title, title_ar, is_reusable_template, approval_status, approved_by, approved_at,
      duration_minutes, open_date, close_date, max_attempts, allow_resume, randomize_questions,
      show_results_to_candidate, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, 'approved', 'usr-admin-1', ?, 90, '2026-10-01', '2026-12-31', 2, 1, 0, 1, ?, ?)`
  ).run(
    templateId,
    mealJobId,
    'MEAL Officer Comprehensive Competency Assessment Battery',
    'بطارية التقييم الشاملة لكفاءات مسؤول المتابعة والتقييم (MEAL)',
    now,
    now,
    now
  );

  const mealItems: Array<Omit<AssessmentItem, 'template_id' | 'job_id'>> = [
    // SECTION 1: TECHNICAL KNOWLEDGE TEST
    {
      id: 'item-meal-tech-1',
      section_type: 'technical',
      question_type: 'mcq',
      prompt:
        'In a project Logical Framework (LogFrame), what is the primary difference between an Output indicator and an Outcome indicator?',
      prompt_ar:
        'في الإطار المنطقي للمشروع (LogFrame)، ما هو الفرق الأساسي بين مؤشر المخرجات (Output) ومؤشر النتائج (Outcome)؟',
      scenario_context: '',
      scenario_context_ar: '',
      options: [
        {
          id: 'a',
          text: 'Outputs measure direct deliverables of activities; Outcomes measure short-to-medium-term behavioral or systemic changes among beneficiaries.',
          text_ar: 'تقيس المخرجات التسليمات المباشرة للأنشطة، بينما تقيس النتائج التغيرات السلوكية أو المؤسسية متوسطة المدى لدى المستفيدين.',
          score: 10,
        },
        {
          id: 'b',
          text: 'Outputs are reported only at project end; Outcomes are tracked weekly by finance.',
          text_ar: 'يتم الإبلاغ عن المخرجات في نهاية المشروع فقط بينما تُتابع النتائج أسبوعياً من المالية.',
          score: 0,
        },
        {
          id: 'c',
          text: 'Outcomes measure budget burn rate; Outputs measure staff attendance.',
          text_ar: 'تقيس النتائج معدل صرف الميزانية والمخرجات تقيس حضور الموظفين.',
          score: 0,
        },
        {
          id: 'd',
          text: 'There is no methodological difference; donors use both terms interchangeably.',
          text_ar: 'لا يوجد فرق منهجي ويستخدمها المانحون بالتبادل.',
          score: 0,
        },
      ],
      correct_answer: 'a',
      marking_guide: 'Option A accurately distinguishes direct activity deliverables from medium-term beneficiary change.',
      marking_guide_ar: 'الخيار أ يميز بدقة بين المخرجات المباشرة والتغير لدى المستفيدين.',
      competency_id: 'comp-meal-1',
      max_score: 10,
      difficulty: 'medium',
      explanation: 'Core RBM/MEAL indicator hierarchy.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 1,
    },
    {
      id: 'item-meal-tech-2',
      section_type: 'technical',
      question_type: 'mcq',
      prompt:
        'When designing an XLSForm for KoboToolbox, which constraint expression ensures that the respondent age entered in ${age} is strictly between 18 and 99?',
      prompt_ar:
        'عند تصميم استمارة XLSForm في KoboToolbox، أي صيغة تحقق (constraint) تضمن أن العمر المدخل في ${age} يقع حصراً بين 18 و 99؟',
      scenario_context: '',
      scenario_context_ar: '',
      options: [
        { id: 'a', text: '. >= 18 and . <= 99', text_ar: '. >= 18 and . <= 99', score: 10 },
        { id: 'b', text: 'age == 18..99', text_ar: 'age == 18..99', score: 0 },
        { id: 'c', text: 'selected(., 18, 99)', text_ar: 'selected(., 18, 99)', score: 0 },
        { id: 'd', text: 'relevant(${age} > 18)', text_ar: 'relevant(${age} > 18)', score: 0 },
      ],
      correct_answer: 'a',
      marking_guide: 'Standard ODK/XLSForm constraint syntax uses `.` for the current question value and `and` operator.',
      marking_guide_ar: 'صيغة ODK القياسية تستخدم النقطة . للقيمة الحالية ومعامل and.',
      competency_id: 'comp-meal-2',
      max_score: 10,
      difficulty: 'medium',
      explanation: 'XLSForm validation rule verification.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 2,
    },
    {
      id: 'item-meal-tech-3',
      section_type: 'technical',
      question_type: 'true_false',
      prompt:
        'True or False: In a Post-Distribution Monitoring (PDM) survey, enumerators should omit beneficiary household IDs from raw Kobo exports before sharing summary dashboards externally to uphold data protection.',
      prompt_ar:
        'صح أم خطأ: في مسح ما بعد التوزيع (PDM)، يجب إزالة معرفات الأسر المستفيدة الشخصية (PII) قبل مشاركة لوحات البيانات الملخصة خارجياً التزاماً بحماية البيانات.',
      scenario_context: '',
      scenario_context_ar: '',
      options: [
        { id: 'true', text: 'True', text_ar: 'صح', score: 10 },
        { id: 'false', text: 'False', text_ar: 'خطأ', score: 0 },
      ],
      correct_answer: 'true',
      marking_guide: 'True — personally identifiable information (PII) must be anonymized prior to external sharing.',
      marking_guide_ar: 'صحيح — يجب إخفاء البيانات الشخصية قبل المشاركة الخارجية.',
      competency_id: 'comp-meal-2',
      max_score: 10,
      difficulty: 'easy',
      explanation: 'Humanitarian data responsibility standard.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 3,
    },
    {
      id: 'item-meal-tech-4',
      section_type: 'technical',
      question_type: 'short_answer',
      prompt:
        'A donor mid-term report shows 120% achievement on training workshops, yet beneficiary post-test scores dropped by 15%. Explain two analytical checks you would run to diagnose this gap and how you would document it in the donor report.',
      prompt_ar:
        'أظهر تقرير منتصف المدة للمانح تحقيق 120% من ورش التدريب، لكن درجات الاختبار البعدي للمستفيدين انخفضت بنسبة 15%. اشرح فحصين تحليليين ستجريهما لتشخيص هذه الفجوة وكيفية توثيقها في تقرير المانح.',
      scenario_context: '',
      scenario_context_ar: '',
      options: [],
      correct_answer: '',
      marking_guide:
        'Look for: (1) Disaggregating by cohort/trainer/location/attendance, (2) Auditing pre/post test alignment & Kobo timestamps, (3) Transparently reporting quality bottleneck + corrective learning action.',
      marking_guide_ar:
        'التركيز على تفكيك البيانات حسب الموقع والمدرب، مراجعة جودة أدوات القياس، والتوثيق الشفاف مع خطة تصحيح.',
      competency_id: 'comp-meal-5',
      max_score: 10,
      difficulty: 'hard',
      explanation: 'Tests donor reporting honesty and analytical diagnostic depth.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 4,
    },

    // SECTION 2: SITUATIONAL JUDGMENT TEST (SJT)
    {
      id: 'item-meal-sjt-1',
      section_type: 'sjt',
      question_type: 'sjt',
      scenario_context:
        'Two days before a major donor quarterly report deadline, you discover that 45 household surveys uploaded by a field partner in KoboToolbox have identical GPS coordinates and 2-minute interview durations (normally 20 minutes). The Program Manager asks you to include them anyway so the target looks achieved.',
      scenario_context_ar:
        'قبل يومين من الموعد النهائي لتقرير المانح، اكتشفت أن 45 استبياناً مرفوعاً عبر KoboToolbox من شريك ميداني تحمل إحداثيات GPS متطابقة ومدة مقابلة دقيقتين فقط (المتوسط الطبيعي 20 دقيقة). طلب منك مدير البرنامج تضمينها حتى يظهر أن الهدف قد تحقق.',
      prompt: 'What is the most effective and ethical action to take?',
      prompt_ar: 'ما هو التصرف الأكثر فعالية وأخلاقية في هذا الموقف؟',
      options: [
        {
          id: 'a',
          text: 'Quarantine the 45 flagged records immediately, verify with the field supervisor/callbacks, exclude unverified records from donor figures, and document the variance transparently.',
          text_ar: 'عزل السجلات الـ 45 المشبوهة فوراً، والتحقق عبر المشرف الميداني وإعادة الاتصال بعينة، واستبعاد غير الموثق منها من أرقام المانح مع توثيق التباين بشفافية.',
          score: 10,
        },
        {
          id: 'b',
          text: 'Include the 45 records in the report to meet the deadline and plan to check them next quarter.',
          text_ar: 'تضمين السجلات الـ 45 في التقرير للالتزام بالموعد النهائي وتأجيل التحقق للربع القادم.',
          score: 2,
        },
        {
          id: 'c',
          text: 'Delete all 45 records silently without informing the Program Manager or the field partner.',
          text_ar: 'حذف السجلات الـ 45 بصمت دون إبلاغ مدير البرنامج أو الشريك الميداني.',
          score: 5,
        },
        {
          id: 'd',
          text: 'Accuse the partner of fraud in an all-staff email before inspecting whether a GPS device malfunctioned.',
          text_ar: 'اتهام الشريك بالتزوير في بريد جماعي قبل فحص احتمال وجود خلل تقني في جهاز تحديد المواقع.',
          score: 4,
        },
      ],
      correct_answer: 'a',
      marking_guide: 'Option A balances data integrity, ethical neutrality, verification protocol, and constructive escalation.',
      marking_guide_ar: 'الخيار أ يوازن بين نزاهة البيانات وبروتوكول التحقق والشفافية المهنية.',
      competency_id: 'comp-meal-6',
      max_score: 10,
      difficulty: 'hard',
      explanation: 'Evaluates integrity under pressure and data quality governance.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 5,
    },
    {
      id: 'item-meal-sjt-2',
      section_type: 'sjt',
      question_type: 'sjt',
      scenario_context:
        'During a community feedback session, a female beneficiary quietly reports that a local distribution committee member is asking for a small fee to keep families on the assistance list. She begs you not to reveal her name.',
      scenario_context_ar:
        'خلال جلسة تغذية راجعة مجتمعية، أبلغتك مستفيدة بهدوء أن أحد أعضاء لجنة التوزيع المحلية يطلب رسماً بسيطاً لإبقاء الأسر في قائمة المساعدات، ورجتك ألا تكشف اسمها.',
      prompt: 'How should you handle this complaint within the Accountability / CRM framework?',
      prompt_ar: 'كيف تتعامل مع هذه الشكوى وفق إطار المساءلة وآليات الشكاوى (CRM)؟',
      options: [
        {
          id: 'a',
          text: 'Log the complaint as a high-priority sensitive PSEA/fraud case using an anonymized code, protect her identity strictly, and escalate immediately to the Safeguarding/Compliance focal point per protocol.',
          text_ar: 'تسجيل الشكوى كحالة حساسة عالية الأولوية برمز مجهول الهوية، وحماية هويتها بشكل صارم، والتصعيد الفوري لمسؤول الحماية والامتثال وفق البروتوكول.',
          score: 10,
        },
        {
          id: 'b',
          text: 'Confront the distribution committee member publicly at the site to stop the behavior immediately.',
          text_ar: 'مواجهة عضو لجنة التوزيع علناً في الموقع لإيقاف السلوك فوراً.',
          score: 3,
        },
        {
          id: 'c',
          text: 'Record her full name and phone number in the shared project WhatsApp group so all field officers know.',
          text_ar: 'تدوين اسمها الكامل ورقمها في مجموعة واتساب المشروع المشتركة لإعلام جميع الموظفين.',
          score: 1,
        },
        {
          id: 'd',
          text: 'Wait to see if three other beneficiaries submit the same complaint before logging it.',
          text_ar: 'الانتظار حتى يقدم ثلاثة مستفيدين آخرين الشكوى نفسها قبل تسجيلها.',
          score: 3,
        },
      ],
      correct_answer: 'a',
      marking_guide: 'Zero-tolerance confidential escalation via coded CRM channel.',
      marking_guide_ar: 'تصعيد سري فوري برمز مشفر وفق بروتوكول الحماية والمساءلة.',
      competency_id: 'comp-meal-4',
      max_score: 10,
      difficulty: 'medium',
      explanation: 'Tests survivor-centered confidentiality and CRM escalation.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 6,
    },
    {
      id: 'item-meal-sjt-3',
      section_type: 'sjt',
      question_type: 'sjt',
      scenario_context:
        'Field officers tell you that the new Kobo monitoring checklist takes too long during emergency distributions and they are considering reverting to paper notes to save time.',
      scenario_context_ar:
        'أبلغك الموظفون الميدانيون أن قائمة التحقق الجديدة في Kobo تستغرق وقتاً طويلاً أثناء التوزيع الطارئ، ويفكرون في العودة للورق لتوفير الوقت.',
      prompt: 'What is the best coordination approach?',
      prompt_ar: 'ما هو أفضل نهج للتنسيق ومعالجة الموقف؟',
      options: [
        {
          id: 'a',
          text: 'Co-review the form with field staff, streamline non-essential fields for rapid emergency mode while preserving core indicator & data quality fields, and pilot the revised form together.',
          text_ar: 'مراجعة الاستمارة مع الفريق الميداني، وتقليص الحقول غير الأساسية لوضع الطوارئ مع إبقاء المؤشرات الجوهرية وقواعد الجودة، وتجربتها معاً.',
          score: 10,
        },
        {
          id: 'b',
          text: 'Insist they fill out every single field without changes and report non-compliance to HR.',
          text_ar: 'الإصرار على تعبئة كل الحقول دون تعديل ورفع مخالفة للموارد البشرية.',
          score: 4,
        },
        {
          id: 'c',
          text: 'Approve reverting permanently to unstructured paper notes without tracking indicators.',
          text_ar: 'الموافقة على العودة الدائمة للملاحظات الورقية غير المهيكلة دون تتبع المؤشرات.',
          score: 2,
        },
        {
          id: 'd',
          text: 'Tell them to skip monitoring completely during emergency distributions.',
          text_ar: 'إبلاغهم بإلغاء المتابعة تماماً أثناء التوزيع الطارئ.',
          score: 1,
        },
      ],
      correct_answer: 'a',
      marking_guide: 'Collaborative adaptation preserving essential data quality.',
      marking_guide_ar: 'تكييف تشاركي يحافظ على المؤشرات الأساسية وجودة البيانات.',
      competency_id: 'comp-meal-10',
      max_score: 10,
      difficulty: 'medium',
      explanation: 'Measures adaptability and cross-team coordination.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 7,
    },

    // SECTION 3: BEHAVIORAL SELF-ASSESSMENT (Non-Diagnostic Likert)
    {
      id: 'item-meal-beh-1',
      section_type: 'behavioral',
      question_type: 'likert',
      prompt: 'When reporting project indicators, I verify source anomalies even if correcting them delays a presentation or reduces headline numbers.',
      prompt_ar: 'عند إعداد تقارير مؤشرات المشروع، أتحقق من الشذوذات في البيانات المصدرية حتى لو أدى تصحيحها إلى تأخير العرض أو تقليص الأرقام المعلنة.',
      scenario_context: 'Workplace Behavioral Self-Assessment (Non-Diagnostic)',
      scenario_context_ar: 'التقييم السلوكي المهني (غير تشخيصي)',
      options: [
        { id: '1', text: '1 - Strongly Disagree', text_ar: '1 - غير موافق بشدة', score: 1 },
        { id: '2', text: '2 - Disagree', text_ar: '2 - غير موافق', score: 2 },
        { id: '3', text: '3 - Neutral', text_ar: '3 - محايد', score: 3 },
        { id: '4', text: '4 - Agree', text_ar: '4 - موافق', score: 4 },
        { id: '5', text: '5 - Strongly Agree', text_ar: '5 - موافق بشدة', score: 5 },
      ],
      correct_answer: '5',
      marking_guide: 'Higher endorsement reflects consistent workplace commitment to data neutrality and integrity.',
      marking_guide_ar: 'الدرجة الأعلى تعكس التزاماً مهنياً متسقاً بنزاهة وحياد البيانات.',
      competency_id: 'comp-meal-6',
      max_score: 5,
      difficulty: 'easy',
      explanation: 'Non-diagnostic behavioral indicator of integrity.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 8,
    },
    {
      id: 'item-meal-beh-2',
      section_type: 'behavioral',
      question_type: 'likert',
      prompt: 'Before drawing conclusions from a survey summary, I routinely cross-check disaggregated subgroups (gender, age, district) to uncover hidden patterns.',
      prompt_ar: 'قبل استخلاص النتائج من ملخص المسح، أتحقق بشكل روتيني من البيانات المفككة حسب الفئات (النوع الاجتماعي، العمر، المنطقة) لكشف الأنماط الخفية.',
      scenario_context: 'Workplace Behavioral Self-Assessment (Non-Diagnostic)',
      scenario_context_ar: 'التقييم السلوكي المهني (غير تشخيصي)',
      options: [
        { id: '1', text: '1 - Strongly Disagree', text_ar: '1 - غير موافق بشدة', score: 1 },
        { id: '2', text: '2 - Disagree', text_ar: '2 - غير موافق', score: 2 },
        { id: '3', text: '3 - Neutral', text_ar: '3 - محايد', score: 3 },
        { id: '4', text: '4 - Agree', text_ar: '4 - موافق', score: 4 },
        { id: '5', text: '5 - Strongly Agree', text_ar: '5 - موافق بشدة', score: 5 },
      ],
      correct_answer: '5',
      marking_guide: 'Indicates analytical thoroughness.',
      marking_guide_ar: 'يعكس دقة التفكير التحليلي.',
      competency_id: 'comp-meal-7',
      max_score: 5,
      difficulty: 'easy',
      explanation: 'Non-diagnostic behavioral indicator of analytical thinking.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 9,
    },
    {
      id: 'item-meal-beh-3',
      section_type: 'behavioral',
      question_type: 'likert',
      prompt: 'During community focus groups, I actively invite quieter participants to share concerns and adapt my language to local cultural norms.',
      prompt_ar: 'أثناء مجموعات النقاش المجتمعية، أحرص على إشراك المشاركين الأقل حديثاً وتكييف أسلوبي مع الأعراف الثقافية المحلية.',
      scenario_context: 'Workplace Behavioral Self-Assessment (Non-Diagnostic)',
      scenario_context_ar: 'التقييم السلوكي المهني (غير تشخيصي)',
      options: [
        { id: '1', text: '1 - Strongly Disagree', text_ar: '1 - غير موافق بشدة', score: 1 },
        { id: '2', text: '2 - Disagree', text_ar: '2 - غير موافق', score: 2 },
        { id: '3', text: '3 - Neutral', text_ar: '3 - محايد', score: 3 },
        { id: '4', text: '4 - Agree', text_ar: '4 - موافق', score: 4 },
        { id: '5', text: '5 - Strongly Agree', text_ar: '5 - موافق بشدة', score: 5 },
      ],
      correct_answer: '5',
      marking_guide: 'Indicates inclusive field facilitation.',
      marking_guide_ar: 'يعكس مهارات التيسير والاستماع الميداني.',
      competency_id: 'comp-meal-8',
      max_score: 5,
      difficulty: 'easy',
      explanation: 'Non-diagnostic behavioral indicator of field facilitation.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 10,
    },
    {
      id: 'item-meal-beh-4',
      section_type: 'behavioral',
      question_type: 'likert',
      prompt: 'When unexpected field disruptions occur near a reporting deadline, I reprioritize tasks calmly and communicate revised timelines early to stakeholders.',
      prompt_ar: 'عند حدوث تغيرات ميدانية مفاجئة قرب موعد التقرير، أعيد ترتيب الأولويات بهدوء وأتواصل مبكراً مع المعنيين بالجدول المعدل.',
      scenario_context: 'Workplace Behavioral Self-Assessment (Non-Diagnostic)',
      scenario_context_ar: 'التقييم السلوكي المهني (غير تشخيصي)',
      options: [
        { id: '1', text: '1 - Strongly Disagree', text_ar: '1 - غير موافق بشدة', score: 1 },
        { id: '2', text: '2 - Disagree', text_ar: '2 - غير موافق', score: 2 },
        { id: '3', text: '3 - Neutral', text_ar: '3 - محايد', score: 3 },
        { id: '4', text: '4 - Agree', text_ar: '4 - موافق', score: 4 },
        { id: '5', text: '5 - Strongly Agree', text_ar: '5 - موافق بشدة', score: 5 },
      ],
      correct_answer: '5',
      marking_guide: 'Indicates adaptability under pressure.',
      marking_guide_ar: 'يعكس المرونة وإدارة الضغط المهني.',
      competency_id: 'comp-meal-9',
      max_score: 5,
      difficulty: 'easy',
      explanation: 'Non-diagnostic behavioral indicator of adaptability.',
      resources: [],
      expected_output: '',
      rubric: [],
      time_limit_minutes: 0,
      approved: true,
      sort_order: 11,
    },

    // SECTION 4: PRACTICAL / WORK SAMPLE ASSESSMENT
    {
      id: 'item-meal-prac-1',
      section_type: 'practical',
      question_type: 'practical_task',
      prompt:
        'Work Sample: Clean the sample PDM survey extract below, identify all data quality issues, calculate the net Indicator Achievement % against the quarterly target of 120 verified households, and write a brief analytical summary for the Program Manager & Power BI dashboard.',
      prompt_ar:
        'نموذج عمل عملي: قم بتنظيف عينة بيانات مسح ما بعد التوزيع أدناه، وحدد جميع مشاكل جودة البيانات، واحسب نسبة تحقق المؤشر الصافية مقارنة بالهدف الربعي (120 أسرة موثقة)، واكتب ملخصاً تحليلياً موجزاً لمدير البرنامج ولوحة Power BI.',
      scenario_context: 'Practical Dataset Cleaning & Indicator Analysis (45 Minutes)',
      scenario_context_ar: 'تنظيف البيانات وتحليل المؤشرات العملي (45 دقيقة)',
      options: [],
      correct_answer: '',
      marking_guide:
        'Candidate must spot: (1) Duplicate HH_ID=HH-104, (2) Negative/invalid household size (-3) on HH-107, (3) Duration 42s anomaly on HH-109, (4) Missing consent="No" on HH-110. Correctly compute cleaned valid records and target achievement %, plus propose 2 Power BI visuals.',
      marking_guide_ar:
        'يجب اكتشاف التكرار (HH-104)، القيمة السالبة (-3)، المدة الشاذة (42 ثانية)، وعدم الموافقة (No)، وحساب النسبة الصحيحة مع اقتراح مرئيات Power BI.',
      competency_id: 'comp-meal-3',
      max_score: 30,
      difficulty: 'hard',
      explanation: 'Simulates real MEAL data cleaning and analytical reporting workflow.',
      resources: [
        'Sample Raw Table (Total Raw Submissions = 100 rows summarized; Key Audit Rows):',
        'HH-101 | District: North | Size: 5 | Consent: Yes | Duration: 19m | Assistance_Received: Yes',
        'HH-104 | District: East  | Size: 4 | Consent: Yes | Duration: 22m | Assistance_Received: Yes',
        'HH-104 | District: East  | Size: 4 | Consent: Yes | Duration: 22m | Assistance_Received: Yes (Duplicate)',
        'HH-107 | District: South | Size: -3 | Consent: Yes | Duration: 18m | Assistance_Received: Yes (Invalid Size)',
        'HH-109 | District: West  | Size: 6 | Consent: Yes | Duration: 42s | Assistance_Received: Yes (Speeding Flag)',
        'HH-110 | District: North | Size: 3 | Consent: No  | Duration: 05m | Assistance_Received: No (No Consent)',
        'Note: Assume remaining 94 rows are verified Yes=88, No=6. Target = 120 verified assisted households.',
      ],
      expected_output:
        '1) Data Quality Audit Log listing all 4 issues; 2) Clean Valid Assisted Count (= 89 or 90 depending on HH-107 verification) & % of 120 target; 3) 150-word analytical brief + Power BI visual layout.',
      rubric: [
        {
          criterion: 'Data Quality Issue Identification (Duplicates, Out-of-Range, Speeding, Consent)',
          criterion_ar: 'اكتشاف مشاكل جودة البيانات (التكرار، القيم الشاذة، السرعة، الموافقة)',
          max_points: 12,
          description: '3 points per anomaly accurately flagged with cleaning rule.',
        },
        {
          criterion: 'Accurate Indicator Calculation & Disaggregation',
          criterion_ar: 'دقة حساب المؤشرات والتفكيك',
          max_points: 10,
          description: 'Correct cleaned denominator/numerator and % vs 120 target.',
        },
        {
          criterion: 'Analytical Clarity & Power BI Dashboard Design',
          criterion_ar: 'وضوح التحليل وتصميم لوحة Power BI',
          max_points: 8,
          description: 'Actionable recommendation for field team and clear KPI/bar/map layout.',
        },
      ],
      time_limit_minutes: 45,
      approved: true,
      sort_order: 12,
    },
  ];

  const insertItem = db.prepare(
    `INSERT INTO assessment_items (
      id, template_id, job_id, section_type, question_type, prompt, prompt_ar,
      scenario_context, scenario_context_ar, options_json, correct_answer,
      marking_guide, marking_guide_ar, competency_id, max_score, difficulty,
      explanation, resources_json, expected_output, rubric_json, time_limit_minutes, approved, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const it of mealItems) {
    insertItem.run(
      it.id,
      templateId,
      mealJobId,
      it.section_type,
      it.question_type,
      it.prompt,
      it.prompt_ar,
      it.scenario_context,
      it.scenario_context_ar,
      JSON.stringify(it.options),
      it.correct_answer,
      it.marking_guide,
      it.marking_guide_ar,
      it.competency_id,
      it.max_score,
      it.difficulty,
      it.explanation,
      JSON.stringify(it.resources),
      it.expected_output,
      JSON.stringify(it.rubric),
      it.time_limit_minutes,
      it.approved ? 1 : 0,
      it.sort_order
    );
  }

  // 7. Seed Assessment Center Config for MEAL Officer
  db.prepare(
    `INSERT INTO assessment_center_configs (id, job_id, purpose, purpose_ar, activities_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    'acc-meal-1',
    mealJobId,
    'Evaluate applied MEAL problem-solving, stakeholder communication under pressure, ethical judgment, and analytical presentation skills in simulated real-world humanitarian scenarios.',
    'تقييم المهارات التطبيقية في المتابعة والتقييم، والتواصل مع أصحاب المصلحة تحت الضغط، والحكم الأخلاقي، والعرض التحليلي ضمن محاكاة عملية.',
    JSON.stringify([
      {
        id: 'act-1',
        name: 'Competency-Based Structured Interview',
        name_ar: 'المقابلة المهيكلة المبنية على الكفاءات',
        type: 'Structured Interview',
        mode: 'online',
        duration_minutes: 45,
        competency_ids: ['comp-meal-1', 'comp-meal-6', 'comp-meal-10'],
        description: 'Standardized STAR behavioral and technical probing across MEAL frameworks and ethical integrity.',
      },
      {
        id: 'act-2',
        name: 'Data Discrepancy Case Study & Briefing',
        name_ar: 'دراسة حالة تباين البيانات والعرض الموجز',
        type: 'Case Study',
        mode: 'in_person',
        duration_minutes: 40,
        competency_ids: ['comp-meal-2', 'comp-meal-3', 'comp-meal-7'],
        description: 'Live presentation of cleaned dataset findings and corrective data quality plan.',
      },
      {
        id: 'act-3',
        name: 'Beneficiary Accountability Role-Play',
        name_ar: 'لعب أدوار جلسة المساءلة المجتمعية',
        type: 'Role-Play Exercise',
        mode: 'in_person',
        duration_minutes: 30,
        competency_ids: ['comp-meal-4', 'comp-meal-8', 'comp-meal-9'],
        description: 'Simulated community meeting addressing sensitive distribution complaints calmly.',
      },
    ])
  );

  // 8. Seed Three Fictional Demonstration Candidates (Explicitly tagged is_sample_demo = 1)
  const demoCandidates: Array<{
    candId: string;
    code: string;
    name: string;
    email: string;
    phone: string;
    location: string;
    cvSummary: string;
    appId: string;
    appCode: string;
    inviteToken: string;
    answers: Record<string, CandidateAnswerRecord>;
    practicalText: string;
    centerRating: number;
    centerCompRatings: Record<string, { rating: number; score: number; comment: string }>;
    observations: string;
    evidence: string;
    aiSummary: string;
  }> = [
    {
      candId: 'cand-demo-1',
      code: 'CAND-DEMO-01',
      name: 'Sara Al-Khatib (Sample Demo)',
      email: 'sara.demo@example.org',
      phone: '+962-79-555-0101',
      location: 'Amman',
      cvSummary:
        'Sample Demo Profile: 5 years MEAL Specialist experience managing KoboToolbox, Power BI dashboards, IPTT tracking, and CRM channels across 4 governorates.',
      appId: 'app-demo-1',
      appCode: 'APP-MEAL-2026-001',
      inviteToken: 'inv-demo-sara-001',
      answers: {
        'item-meal-tech-1': { item_id: 'item-meal-tech-1', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-tech-2': { item_id: 'item-meal-tech-2', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-tech-3': { item_id: 'item-meal-tech-3', selected_option_id: 'true', awarded_score: 10 },
        'item-meal-tech-4': {
          item_id: 'item-meal-tech-4',
          text_response:
            'Run cohort & trainer disaggregation in Power BI and audit pre/post test difficulty alignment & Kobo submission timestamps. Document root cause openly in donor narrative with remedial coaching plan.',
          awarded_score: 9,
          grader_comment: 'Clear diagnostic plan and transparent donor reporting.',
        },
        'item-meal-sjt-1': { item_id: 'item-meal-sjt-1', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-sjt-2': { item_id: 'item-meal-sjt-2', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-sjt-3': { item_id: 'item-meal-sjt-3', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-beh-1': { item_id: 'item-meal-beh-1', selected_option_id: '5', awarded_score: 5 },
        'item-meal-beh-2': { item_id: 'item-meal-beh-2', selected_option_id: '5', awarded_score: 5 },
        'item-meal-beh-3': { item_id: 'item-meal-beh-3', selected_option_id: '4', awarded_score: 4 },
        'item-meal-beh-4': { item_id: 'item-meal-beh-4', selected_option_id: '5', awarded_score: 5 },
        'item-meal-prac-1': {
          item_id: 'item-meal-prac-1',
          text_response:
            'Audit Findings: 1) HH-104 duplicate removed (-1); 2) HH-107 negative size -3 quarantined for callback; 3) HH-109 42s speeding flagged; 4) HH-110 excluded (no consent). Net verified assisted = 89/120 (74.2%). Power BI: KPI card, district bar chart, data-quality flag table.',
          awarded_score: 27,
          grader_comment: 'Spotted all 4 data quality flaws accurately and designed clean KPI visual plan.',
        },
      },
      practicalText:
        'Audit Findings: 1) HH-104 duplicate removed (-1); 2) HH-107 negative size -3 quarantined for callback; 3) HH-109 42s speeding flagged; 4) HH-110 excluded (no consent). Net verified assisted = 89/120 (74.2%).',
      centerRating: 4.5,
      centerCompRatings: {
        'comp-meal-1': { rating: 5, score: 92, comment: 'Strong LogFrame mastery.' },
        'comp-meal-3': { rating: 4, score: 86, comment: 'Clear Power BI structure.' },
        'comp-meal-6': { rating: 5, score: 94, comment: 'Exemplary data integrity stance.' },
        'comp-meal-8': { rating: 4, score: 84, comment: 'Empathetic facilitation.' },
      },
      observations:
        'Structured, calm, and rigorous during the Data Discrepancy Case Study. Explained Kobo audit trail clearly.',
      evidence:
        'Correctly resolved duplicate & speeding records in work sample (27/30) and defended ethical exclusion in role-play.',
      aiSummary:
        'Sample Demo Summary: Sara Al-Khatib demonstrated strong mastery across all critical competencies (MEAL Frameworks, Kobo/ODK Data Quality, and Ethical Integrity), achieving 89% overall with zero threshold failures.',
    },
    {
      candId: 'cand-demo-2',
      code: 'CAND-DEMO-02',
      name: 'Omar Al-Nasser (Sample Demo)',
      email: 'omar.demo@example.org',
      phone: '+962-79-555-0102',
      location: 'Irbid',
      cvSummary:
        'Sample Demo Profile: 3 years Field Data Assistant and Excel Analyst with solid KoboToolbox deployment skills; transitioning to full MEAL Officer responsibilities.',
      appId: 'app-demo-2',
      appCode: 'APP-MEAL-2026-002',
      inviteToken: 'inv-demo-omar-002',
      answers: {
        'item-meal-tech-1': { item_id: 'item-meal-tech-1', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-tech-2': { item_id: 'item-meal-tech-2', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-tech-3': { item_id: 'item-meal-tech-3', selected_option_id: 'true', awarded_score: 10 },
        'item-meal-tech-4': {
          item_id: 'item-meal-tech-4',
          text_response: 'Compare trainer attendance sheets and check if questions were too hard.',
          awarded_score: 5,
          grader_comment: 'Surface-level analysis; missed donor reporting & Kobo audit steps.',
        },
        'item-meal-sjt-1': { item_id: 'item-meal-sjt-1', selected_option_id: 'c', awarded_score: 5 },
        'item-meal-sjt-2': { item_id: 'item-meal-sjt-2', selected_option_id: 'b', awarded_score: 3 },
        'item-meal-sjt-3': { item_id: 'item-meal-sjt-3', selected_option_id: 'a', awarded_score: 10 },
        'item-meal-beh-1': { item_id: 'item-meal-beh-1', selected_option_id: '4', awarded_score: 4 },
        'item-meal-beh-2': { item_id: 'item-meal-beh-2', selected_option_id: '4', awarded_score: 4 },
        'item-meal-beh-3': { item_id: 'item-meal-beh-3', selected_option_id: '4', awarded_score: 4 },
        'item-meal-beh-4': { item_id: 'item-meal-beh-4', selected_option_id: '3', awarded_score: 3 },
        'item-meal-prac-1': {
          item_id: 'item-meal-prac-1',
          text_response:
            'Removed duplicate HH-104 and negative value HH-107. Calculated 90/120 = 75%. Missed 42s speeding flag.',
          awarded_score: 21,
          grader_comment: 'Good Excel math, missed speeding metadata check and Power BI layout.',
        },
      },
      practicalText: 'Removed duplicate HH-104 and negative value HH-107. Calculated 90/120 = 75%.',
      centerRating: 3.4,
      centerCompRatings: {
        'comp-meal-1': { rating: 4, score: 76, comment: 'Good grasp of indicators.' },
        'comp-meal-4': { rating: 2, score: 52, comment: 'Suggested public confrontation during CRM role-play.' },
        'comp-meal-6': { rating: 3, score: 66, comment: 'Needs coaching on transparent escalation.' },
        'comp-meal-10': { rating: 4, score: 78, comment: 'Strong collaborative spirit.' },
      },
      observations:
        'Strong technical Kobo & Excel aptitude, but struggled in CRM confidentiality protocol during SJT and Role-Play.',
      evidence:
        'Scored 21/30 on practical task; chose public confrontation option in CRM SJT (3/10) and silent deletion in data SJT (5/10).',
      aiSummary:
        'Sample Demo Summary: Omar Al-Nasser meets technical Kobo/Excel requirements but requires Further Review due to borderline scores on Critical Integrity/Escalation and Accountability CRM protocols.',
    },
    {
      candId: 'cand-demo-3',
      code: 'CAND-DEMO-03',
      name: 'Reem Al-Harbi (Sample Demo)',
      email: 'reem.demo@example.org',
      phone: '+962-79-555-0103',
      location: 'Zarqa',
      cvSummary:
        'Sample Demo Profile: 1.5 years Administrative Coordinator with basic Excel exposure; limited hands-on KoboToolbox or LogFrame experience.',
      appId: 'app-demo-3',
      appCode: 'APP-MEAL-2026-003',
      inviteToken: 'inv-demo-reem-003',
      answers: {
        'item-meal-tech-1': { item_id: 'item-meal-tech-1', selected_option_id: 'd', awarded_score: 0 },
        'item-meal-tech-2': { item_id: 'item-meal-tech-2', selected_option_id: 'b', awarded_score: 0 },
        'item-meal-tech-3': { item_id: 'item-meal-tech-3', selected_option_id: 'true', awarded_score: 10 },
        'item-meal-tech-4': {
          item_id: 'item-meal-tech-4',
          text_response: 'Ask trainers to repeat the session.',
          awarded_score: 3,
          grader_comment: 'Lacks structured MEAL root-cause diagnostics.',
        },
        'item-meal-sjt-1': { item_id: 'item-meal-sjt-1', selected_option_id: 'b', awarded_score: 2 },
        'item-meal-sjt-2': { item_id: 'item-meal-sjt-2', selected_option_id: 'd', awarded_score: 3 },
        'item-meal-sjt-3': { item_id: 'item-meal-sjt-3', selected_option_id: 'b', awarded_score: 4 },
        'item-meal-beh-1': { item_id: 'item-meal-beh-1', selected_option_id: '3', awarded_score: 3 },
        'item-meal-beh-2': { item_id: 'item-meal-beh-2', selected_option_id: '3', awarded_score: 3 },
        'item-meal-beh-3': { item_id: 'item-meal-beh-3', selected_option_id: '4', awarded_score: 4 },
        'item-meal-beh-4': { item_id: 'item-meal-beh-4', selected_option_id: '3', awarded_score: 3 },
        'item-meal-prac-1': {
          item_id: 'item-meal-prac-1',
          text_response: 'Total surveys = 100 out of 120 = 83.3%. No records removed.',
          awarded_score: 8,
          grader_comment: 'Did not clean duplicates, invalid negative values, speeding, or missing consent.',
        },
      },
      practicalText: 'Total surveys = 100 out of 120 = 83.3%.',
      centerRating: 2.5,
      centerCompRatings: {
        'comp-meal-1': { rating: 2, score: 42, comment: 'Unable to distinguish outputs vs outcomes.' },
        'comp-meal-2': { rating: 2, score: 45, comment: 'Unfamiliar with XLSForm constraints.' },
        'comp-meal-6': { rating: 3, score: 58, comment: 'Deferred too readily to manager pressure on flawed data.' },
      },
      observations:
        'Courteous communicator, but lacks foundational MEAL technical readiness and data quality judgment.',
      evidence:
        'Missed LogFrame and XLSForm technical items (13/40), included unverified records in practical sample (8/30).',
      aiSummary:
        'Sample Demo Summary: Reem Al-Harbi currently Does Not Meet Requirements for the MEAL Officer role due to critical gaps in MEAL Frameworks, Kobo/Data Quality, and Ethical Data Escalation.',
    },
  ];

  // Hydrate competency & item arrays for scoring
  const mealCompRows = db
    .prepare('SELECT * FROM competencies WHERE job_id = ? ORDER BY sort_order')
    .all(mealJobId) as Array<Record<string, unknown>>;
  const hydratedComps: Competency[] = mealCompRows.map((r) => ({
    id: String(r.id),
    job_id: String(r.job_id),
    name: String(r.name),
    name_ar: String(r.name_ar),
    description: String(r.description),
    description_ar: String(r.description_ar),
    category: r.category as 'Technical' | 'Behavioral',
    importance: r.importance as 'Critical' | 'High' | 'Medium',
    is_critical: Boolean(r.is_critical),
    weight: Number(r.weight),
    assessment_method: String(r.assessment_method),
    expected_level: String(r.expected_level),
    min_threshold: Number(r.min_threshold),
    sort_order: Number(r.sort_order),
  }));

  const mealItemRows = db
    .prepare('SELECT * FROM assessment_items WHERE template_id = ? ORDER BY sort_order')
    .all(templateId) as Array<Record<string, unknown>>;
  const hydratedItems: AssessmentItem[] = mealItemRows.map((r) => ({
    id: String(r.id),
    template_id: String(r.template_id),
    job_id: String(r.job_id),
    section_type: r.section_type as AssessmentItem['section_type'],
    question_type: r.question_type as AssessmentItem['question_type'],
    prompt: String(r.prompt),
    prompt_ar: String(r.prompt_ar),
    scenario_context: String(r.scenario_context),
    scenario_context_ar: String(r.scenario_context_ar),
    options: JSON.parse(String(r.options_json || '[]')),
    correct_answer: String(r.correct_answer),
    marking_guide: String(r.marking_guide),
    marking_guide_ar: String(r.marking_guide_ar),
    competency_id: String(r.competency_id),
    max_score: Number(r.max_score),
    difficulty: r.difficulty as 'easy' | 'medium' | 'hard',
    explanation: String(r.explanation),
    resources: JSON.parse(String(r.resources_json || '[]')),
    expected_output: String(r.expected_output),
    rubric: JSON.parse(String(r.rubric_json || '[]')),
    time_limit_minutes: Number(r.time_limit_minutes),
    approved: Boolean(r.approved),
    sort_order: Number(r.sort_order),
  }));

  for (const dc of demoCandidates) {
    db.prepare(
      `INSERT INTO candidates (
        id, candidate_code, full_name, email, phone, location, cv_text_summary,
        consent_accepted, consent_at, is_sample_demo, archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, ?)`
    ).run(dc.candId, dc.code, dc.name, dc.email, dc.phone, dc.location, dc.cvSummary, now, now, now);

    db.prepare(
      `INSERT INTO applications (
        id, application_code, job_id, campaign_id, candidate_id, status, current_stage,
        invite_token, applied_at, final_recommendation, human_decision, decision_notes
      ) VALUES (?, ?, ?, ?, ?, 'final_review', 'Final Review', ?, ?, 'pending', 'pending', '')`
    ).run(dc.appId, dc.appCode, mealJobId, campaignId, dc.candId, dc.inviteToken, now);

    const assignId = `asg-${dc.candId}`;
    db.prepare(
      `INSERT INTO assessment_assignments (
        id, application_id, template_id, job_id, candidate_id, status, attempts_allowed,
        due_date, assigned_by, assigned_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 2, '2026-12-15', 'usr-admin-1', ?)`
    ).run(assignId, dc.appId, templateId, mealJobId, dc.candId, now);

    const schedId = `sch-${dc.candId}`;
    db.prepare(
      `INSERT INTO assessment_center_schedules (
        id, job_id, application_id, candidate_id, activity_name, activity_type, mode,
        scheduled_at, duration_minutes, location_or_link, assessor_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'Case Study', 'online', '2026-11-12T10:00:00Z', 45, 'https://meet.smartmasar.org/room-meal', 'usr-assessor-1', 'completed', ?)`
    ).run(schedId, mealJobId, dc.appId, dc.candId, 'Competency Interview & Data Case Study', now);

    const evalId = `ev-${dc.candId}`;
    db.prepare(
      `INSERT INTO assessor_evaluations (
        id, schedule_id, application_id, job_id, candidate_id, assessor_id,
        observations, evidence, competency_ratings_json, overall_rating, comments, submitted_at
      ) VALUES (?, ?, ?, ?, ?, 'usr-assessor-1', ?, ?, ?, ?, ?, ?)`
    ).run(
      evalId,
      schedId,
      dc.appId,
      mealJobId,
      dc.candId,
      dc.observations,
      dc.evidence,
      JSON.stringify(dc.centerCompRatings),
      dc.centerRating,
      'Completed structured Assessment Center rubric.',
      now
    );

    const assessorEvals: AssessorEvaluation[] = [
      {
        id: evalId,
        schedule_id: schedId,
        application_id: dc.appId,
        job_id: mealJobId,
        candidate_id: dc.candId,
        assessor_id: 'usr-assessor-1',
        observations: dc.observations,
        evidence: dc.evidence,
        competency_ratings: dc.centerCompRatings,
        overall_rating: dc.centerRating,
        comments: 'Completed structured Assessment Center rubric.',
        submitted_at: now,
      },
    ];

    const scored = computeCandidateScoring({
      items: hydratedItems,
      competencies: hydratedComps,
      answers: dc.answers,
      practicalSubmissionText: dc.practicalText,
      assessorEvaluations: assessorEvals,
      assessmentWeights: defaultWeights,
      passingThreshold: 70,
    });

    db.prepare(
      `INSERT INTO assessment_attempts (
        id, assignment_id, application_id, template_id, job_id, candidate_id, attempt_number,
        status, started_at, submitted_at, answers_json, practical_submission_text,
        section_scores_json, competency_scores_json, overall_score, threshold_passed, critical_passed,
        evaluation_category, strengths_json, improvement_areas_json, threshold_failures_json,
        evaluator_notes, evaluated_by, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'evaluated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr-admin-1', ?)`
    ).run(
      `att-${dc.candId}-1`,
      assignId,
      dc.appId,
      templateId,
      mealJobId,
      dc.candId,
      now,
      now,
      JSON.stringify(scored.updated_answers),
      dc.practicalText,
      JSON.stringify(scored.section_scores),
      JSON.stringify(scored.competency_scores),
      scored.overall_score,
      scored.threshold_passed ? 1 : 0,
      scored.critical_passed ? 1 : 0,
      scored.evaluation_category,
      JSON.stringify(scored.strengths),
      JSON.stringify(scored.improvement_areas),
      JSON.stringify(scored.threshold_failures),
      'Initial academic demonstration evaluation record (editable & archivable).',
      now
    );

    db.prepare('UPDATE applications SET final_recommendation = ? WHERE id = ?').run(
      scored.evaluation_category,
      dc.appId
    );

    db.prepare(
      `INSERT INTO evaluation_reports (
        id, application_id, job_id, candidate_id, ai_summary, strengths_json, improvement_areas_json,
        human_notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`
    ).run(
      `rep-${dc.candId}`,
      dc.appId,
      mealJobId,
      dc.candId,
      dc.aiSummary,
      JSON.stringify(scored.strengths),
      JSON.stringify(scored.improvement_areas),
      'Sample demonstration report awaiting human HR committee sign-off.',
      now
    );
  }

  logAudit({
    userId: 'system',
    userName: 'System Initializer',
    userRole: 'system',
    action: 'SEED_INITIAL_DATA',
    entityType: 'system',
    entityId: 'smart-masar',
    details: 'Initialized Smart Masar with MEAL Officer sample job and 3 labeled fictional demonstration candidates.',
  });
}
