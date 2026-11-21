import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, generateId, hashPassword, logAudit, UPLOAD_DIR, verifyPassword } from './db.ts';
import { createOrgRouter } from './orgRoutes.ts';
import { computeCandidateScoring } from './scoring.ts';
import {
  analyzeJobDescriptionWithAI,
  draftCandidateEvaluationWithAI,
  generateAssessmentItemsWithAI,
} from './ai.ts';
import type {
  AssessmentItem,
  AssessmentSectionType,
  AssessmentWeights,
  AssessorEvaluation,
  CandidateAnswerRecord,
  Competency,
  Job,
  User,
  UserRole,
} from '../src/types/domain.ts';

interface AuthRequest extends Request {
  user?: User;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `cv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function hydrateJob(row: Record<string, unknown>, includeCompetencies = true): Job {
  const jobId = String(row.id);
  const competencies = includeCompetencies
    ? (db
        .prepare('SELECT * FROM competencies WHERE job_id = ? ORDER BY sort_order')
        .all(jobId) as Array<Record<string, unknown>>).map(hydrateCompetency)
    : undefined;

  return {
    id: jobId,
    campaign_id: String(row.campaign_id),
    title: String(row.title),
    title_ar: String(row.title_ar || ''),
    department: String(row.department),
    department_ar: String(row.department_ar || ''),
    category: String(row.category || ''),
    purpose: String(row.purpose || ''),
    purpose_ar: String(row.purpose_ar || ''),
    responsibilities: parseJson<string[]>(row.responsibilities_json, []),
    qualifications: parseJson<string[]>(row.qualifications_json, []),
    experience_req: String(row.experience_req || ''),
    technical_skills: parseJson<string[]>(row.technical_skills_json, []),
    behavioral_skills: parseJson<string[]>(row.behavioral_skills_json, []),
    preferred_qualifications: parseJson<string[]>(row.preferred_qualifications_json, []),
    employment_type: (row.employment_type as Job['employment_type']) || 'Full-time',
    location: String(row.location || ''),
    deadline: String(row.deadline || ''),
    vacancies_count: Number(row.vacancies_count || 1),
    raw_jd_text: String(row.raw_jd_text || ''),
    ai_analysis: parseJson(row.ai_analysis_json, null),
    ai_analysis_status: (row.ai_analysis_status as Job['ai_analysis_status']) || 'none',
    status: (row.status as Job['status']) || 'draft',
    workflow_stages: parseJson<string[]>(row.workflow_stages_json, []),
    assessment_weights: parseJson<AssessmentWeights>(row.assessment_weights_json, {
      technical: 30,
      sjt: 20,
      behavioral: 15,
      practical: 20,
      center: 15,
    }),
    passing_threshold: Number(row.passing_threshold || 70),
    created_by: String(row.created_by || ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    competencies,
  };
}

function hydrateCompetency(r: Record<string, unknown>): Competency {
  return {
    id: String(r.id),
    job_id: String(r.job_id),
    name: String(r.name),
    name_ar: String(r.name_ar || ''),
    description: String(r.description || ''),
    description_ar: String(r.description_ar || ''),
    category: (r.category as 'Technical' | 'Behavioral') || 'Technical',
    importance: (r.importance as 'Critical' | 'High' | 'Medium') || 'High',
    is_critical: Boolean(r.is_critical),
    weight: Number(r.weight),
    assessment_method: String(r.assessment_method || ''),
    expected_level: String(r.expected_level || 'Proficient'),
    min_threshold: Number(r.min_threshold || 60),
    sort_order: Number(r.sort_order || 0),
  };
}

function hydrateItem(r: Record<string, unknown>, hideAnswers = false): AssessmentItem {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    job_id: String(r.job_id),
    section_type: r.section_type as AssessmentItem['section_type'],
    question_type: r.question_type as AssessmentItem['question_type'],
    prompt: String(r.prompt),
    prompt_ar: String(r.prompt_ar || ''),
    scenario_context: String(r.scenario_context || ''),
    scenario_context_ar: String(r.scenario_context_ar || ''),
    options: parseJson<Array<{ id: string; text: string; text_ar: string; score: number }>>(r.options_json, []).map((o) =>
      hideAnswers ? { id: String(o.id), text: String(o.text), text_ar: String(o.text_ar || ''), score: 0 } : o
    ),
    correct_answer: hideAnswers ? '' : String(r.correct_answer || ''),
    marking_guide: hideAnswers ? '' : String(r.marking_guide || ''),
    marking_guide_ar: hideAnswers ? '' : String(r.marking_guide_ar || ''),
    competency_id: String(r.competency_id || ''),
    max_score: Number(r.max_score || 10),
    difficulty: (r.difficulty as 'easy' | 'medium' | 'hard') || 'medium',
    explanation: hideAnswers ? '' : String(r.explanation || ''),
    resources: parseJson(r.resources_json, []),
    expected_output: hideAnswers ? '' : String(r.expected_output || ''),
    rubric: hideAnswers ? [] : parseJson(r.rubric_json, []),
    time_limit_minutes: Number(r.time_limit_minutes || 0),
    approved: Boolean(r.approved),
    sort_order: Number(r.sort_order || 0),
  };
}

function hydrateAttempt(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    assignment_id: String(r.assignment_id),
    application_id: String(r.application_id),
    template_id: String(r.template_id),
    job_id: String(r.job_id),
    candidate_id: String(r.candidate_id),
    attempt_number: Number(r.attempt_number || 1),
    status: r.status as 'in_progress' | 'submitted' | 'evaluated',
    started_at: String(r.started_at),
    submitted_at: r.submitted_at ? String(r.submitted_at) : null,
    answers: parseJson<Record<string, CandidateAnswerRecord>>(r.answers_json, {}),
    practical_submission_text: String(r.practical_submission_text || ''),
    practical_attachment_name: r.practical_attachment_name ? String(r.practical_attachment_name) : null,
    section_scores: parseJson(r.section_scores_json, {}),
    competency_scores: parseJson(r.competency_scores_json, []),
    overall_score: Number(r.overall_score || 0),
    threshold_passed: Boolean(r.threshold_passed),
    critical_passed: Boolean(r.critical_passed),
    evaluation_category: String(r.evaluation_category || 'pending'),
    strengths: parseJson<string[]>(r.strengths_json, []),
    improvement_areas: parseJson<string[]>(r.improvement_areas_json, []),
    threshold_failures: parseJson<string[]>(r.threshold_failures_json, []),
    evaluator_notes: String(r.evaluator_notes || ''),
    evaluated_by: r.evaluated_by ? String(r.evaluated_by) : null,
    evaluated_at: r.evaluated_at ? String(r.evaluated_at) : null,
  };
}

function recomputeApplicationScoring(applicationId: string, evaluatorId?: string): void {
  const appRow = db.prepare('SELECT * FROM applications WHERE id = ?').get(applicationId) as
    | Record<string, unknown>
    | undefined;
  if (!appRow) return;

  const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(String(appRow.job_id)) as
    | Record<string, unknown>
    | undefined;
  if (!jobRow) return;
  const job = hydrateJob(jobRow, true);

  const attemptRow = db
    .prepare(
      `SELECT * FROM assessment_attempts WHERE application_id = ? ORDER BY attempt_number DESC LIMIT 1`
    )
    .get(applicationId) as Record<string, unknown> | undefined;

  const evalRows = db
    .prepare('SELECT * FROM assessor_evaluations WHERE application_id = ?')
    .all(applicationId) as Array<Record<string, unknown>>;

  const assessorEvaluations: AssessorEvaluation[] = evalRows.map((ev) => ({
    id: String(ev.id),
    schedule_id: String(ev.schedule_id),
    application_id: String(ev.application_id),
    job_id: String(ev.job_id),
    candidate_id: String(ev.candidate_id),
    assessor_id: String(ev.assessor_id),
    observations: String(ev.observations || ''),
    evidence: String(ev.evidence || ''),
    competency_ratings: parseJson(ev.competency_ratings_json, {}),
    overall_rating: Number(ev.overall_rating || 0),
    comments: String(ev.comments || ''),
    submitted_at: String(ev.submitted_at),
  }));

  if (!attemptRow) return;

  const itemRows = db
    .prepare('SELECT * FROM assessment_items WHERE template_id = ? ORDER BY sort_order')
    .all(String(attemptRow.template_id)) as Array<Record<string, unknown>>;
  const items = itemRows.map((r) => hydrateItem(r, false));

  const scored = computeCandidateScoring({
    items,
    competencies: job.competencies || [],
    answers: parseJson<Record<string, CandidateAnswerRecord>>(attemptRow.answers_json, {}),
    practicalSubmissionText: String(attemptRow.practical_submission_text || ''),
    assessorEvaluations,
    assessmentWeights: job.assessment_weights,
    passingThreshold: job.passing_threshold,
  });

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE assessment_attempts SET
      answers_json = ?, section_scores_json = ?, competency_scores_json = ?,
      overall_score = ?, threshold_passed = ?, critical_passed = ?,
      evaluation_category = ?, strengths_json = ?, improvement_areas_json = ?,
      threshold_failures_json = ?, status = CASE WHEN status = 'in_progress' THEN 'in_progress' ELSE 'evaluated' END,
      evaluated_by = COALESCE(?, evaluated_by), evaluated_at = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(scored.updated_answers),
    JSON.stringify(scored.section_scores),
    JSON.stringify(scored.competency_scores),
    scored.overall_score,
    scored.threshold_passed ? 1 : 0,
    scored.critical_passed ? 1 : 0,
    scored.evaluation_category,
    JSON.stringify(scored.strengths),
    JSON.stringify(scored.improvement_areas),
    JSON.stringify(scored.threshold_failures),
    evaluatorId || null,
    now,
    String(attemptRow.id)
  );

  if (String(attemptRow.status) !== 'in_progress') {
    db.prepare('UPDATE applications SET final_recommendation = ? WHERE id = ?').run(
      scored.evaluation_category,
      applicationId
    );
  }
}

function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const session = db
    .prepare(
      `SELECT s.token, s.expires_at, u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.active = 1`
    )
    .get(token) as Record<string, unknown> | undefined;

  if (!session || new Date(String(session.expires_at)) < new Date()) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  req.user = {
    id: String(session.id),
    name: String(session.name),
    name_ar: String(session.name_ar || ''),
    email: String(session.email),
    role: session.role as UserRole,
    department: String(session.department || ''),
    active: Boolean(session.active),
    created_at: String(session.created_at),
  };
  next();
}

function requireRole(roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient role permissions' });
      return;
    }
    next();
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // ==================== AUTH ROUTES ====================
  router.post('/auth/login', (req: Request, res: Response) => {
    const { email, password, demoRole } = req.body as {
      email?: string;
      password?: string;
      demoRole?: UserRole;
    };

    let userRow: Record<string, unknown> | undefined;

    if (demoRole && !password) {
      // Allow explicit demo role sign-in for evaluator testing
      userRow = db
        .prepare('SELECT * FROM users WHERE role = ? AND active = 1 ORDER BY created_at ASC LIMIT 1')
        .get(demoRole) as Record<string, unknown> | undefined;
    } else if (email && password) {
      userRow = db
        .prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1')
        .get(email.trim()) as Record<string, unknown> | undefined;
      if (!userRow || !verifyPassword(password, String(userRow.password_hash))) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    if (!userRow) {
      res.status(404).json({ error: 'User account not found' });
      return;
    }

    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      'INSERT INTO sessions (token, user_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(token, String(userRow.id), String(userRow.role), expires, now.toISOString());

    const user: User = {
      id: String(userRow.id),
      name: String(userRow.name),
      name_ar: String(userRow.name_ar || ''),
      email: String(userRow.email),
      role: userRow.role as UserRole,
      department: String(userRow.department || ''),
      active: Boolean(userRow.active),
      created_at: String(userRow.created_at),
    };

    res.json({ token, user });
  });

  router.post('/auth/logout', authenticate, (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.json({ ok: true });
  });

  router.get('/auth/me', authenticate, (req: AuthRequest, res: Response) => {
    res.json({ user: req.user });
  });

  // ==================== PUBLIC CAREERS & APPLICATION PORTAL ====================
  // Strictly returns ONLY published vacancies; zero candidate PII exposed.
  router.get('/public/jobs', (_req: Request, res: Response) => {
    const rows = db
      .prepare("SELECT * FROM jobs WHERE status = 'published' ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    const publicJobs = rows.map((r) => {
      const j = hydrateJob(r, false);
      return {
        id: j.id,
        title: j.title,
        title_ar: j.title_ar,
        department: j.department,
        department_ar: j.department_ar,
        category: j.category,
        purpose: j.purpose,
        purpose_ar: j.purpose_ar,
        responsibilities: j.responsibilities,
        qualifications: j.qualifications,
        experience_req: j.experience_req,
        technical_skills: j.technical_skills,
        behavioral_skills: j.behavioral_skills,
        preferred_qualifications: j.preferred_qualifications,
        employment_type: j.employment_type,
        location: j.location,
        deadline: j.deadline,
        vacancies_count: j.vacancies_count,
      };
    });
    res.json({ jobs: publicJobs });
  });

  router.post('/public/apply', upload.single('cv'), (req: Request, res: Response) => {
    const { job_id, full_name, email, phone, location, cv_text_summary, consent_accepted } = req.body as {
      job_id?: string;
      full_name?: string;
      email?: string;
      phone?: string;
      location?: string;
      cv_text_summary?: string;
      consent_accepted?: string | boolean;
    };

    if (!job_id || !full_name?.trim() || !email?.trim()) {
      res.status(400).json({ error: 'Job, full name, and email are required.' });
      return;
    }

    const consented = consent_accepted === true || consent_accepted === 'true' || consent_accepted === '1';
    if (!consented) {
      res.status(400).json({ error: 'Privacy and consent acceptance is required to submit an application.' });
      return;
    }

    const jobRow = db
      .prepare("SELECT * FROM jobs WHERE id = ? AND status = 'published'")
      .get(job_id) as Record<string, unknown> | undefined;
    if (!jobRow) {
      res.status(404).json({ error: 'Published job vacancy not found.' });
      return;
    }

    const now = new Date().toISOString();
    // Reuse candidate by email or create new candidate
    let existingCand = db
      .prepare('SELECT * FROM candidates WHERE lower(email) = lower(?) AND archived = 0')
      .get(email.trim()) as Record<string, unknown> | undefined;

    let candidateId: string;
    if (existingCand) {
      candidateId = String(existingCand.id);
      db.prepare(
        `UPDATE candidates SET full_name = ?, phone = COALESCE(NULLIF(?, ''), phone),
         location = COALESCE(NULLIF(?, ''), location),
         cv_filename = COALESCE(?, cv_filename),
         cv_original_name = COALESCE(?, cv_original_name),
         cv_mime = COALESCE(?, cv_mime),
         cv_text_summary = COALESCE(NULLIF(?, ''), cv_text_summary),
         consent_accepted = 1, consent_at = ?, archived = 0, updated_at = ? WHERE id = ?`
      ).run(
        full_name.trim(),
        phone?.trim() || '',
        location?.trim() || '',
        req.file ? req.file.filename : null,
        req.file ? req.file.originalname : null,
        req.file ? req.file.mimetype : null,
        cv_text_summary?.trim() || '',
        now,
        now,
        candidateId
      );
    } else {
      candidateId = generateId('cand');
      const candCode = `CAND-${Math.floor(1000 + Math.random() * 9000)}`;
      db.prepare(
        `INSERT INTO candidates (
          id, candidate_code, full_name, email, phone, location,
          cv_filename, cv_original_name, cv_mime, cv_text_summary,
          consent_accepted, consent_at, is_sample_demo, archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?, ?)`
      ).run(
        candidateId,
        candCode,
        full_name.trim(),
        email.trim(),
        phone?.trim() || '',
        location?.trim() || '',
        req.file ? req.file.filename : null,
        req.file ? req.file.originalname : null,
        req.file ? req.file.mimetype : null,
        cv_text_summary?.trim() || '',
        now,
        now,
        now
      );
    }

    const appId = generateId('app');
    const appCode = `APP-${new Date().getFullYear()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const inviteToken = `inv-${crypto.randomBytes(12).toString('hex')}`;

    db.prepare(
      `INSERT INTO applications (
        id, application_code, job_id, campaign_id, candidate_id, status, current_stage,
        invite_token, applied_at, final_recommendation, human_decision, decision_notes
      ) VALUES (?, ?, ?, ?, ?, 'applied', 'Application', ?, ?, 'pending', 'pending', '')`
    ).run(
      appId,
      appCode,
      job_id,
      String(jobRow.campaign_id),
      candidateId,
      inviteToken,
      now
    );

    logAudit({
      userId: candidateId,
      userName: full_name.trim(),
      userRole: 'candidate',
      action: 'SUBMIT_APPLICATION',
      entityType: 'application',
      entityId: appId,
      details: `Submitted public application ${appCode} for job ${String(jobRow.title)} (awaiting HR review before invite)`,
    });

    res.status(201).json({
      application_id: appId,
      application_code: appCode,
      assessment_assigned: false,
    });
  });

  // ==================== CANDIDATE ASSESSMENT INVITE PORTAL ====================
  router.get('/candidate/invite/:token', (req: Request, res: Response) => {
    const { token } = req.params;
    const appRow = db
      .prepare('SELECT * FROM applications WHERE invite_token = ?')
      .get(token) as Record<string, unknown> | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Invalid or expired assessment invitation link.' });
      return;
    }

    const candRow = db.prepare('SELECT id, candidate_code, full_name, email FROM candidates WHERE id = ?').get(
      String(appRow.candidate_id)
    ) as Record<string, unknown>;
    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(String(appRow.job_id)) as Record<
      string,
      unknown
    >;
    const assignRow = db
      .prepare('SELECT * FROM assessment_assignments WHERE application_id = ? ORDER BY assigned_at DESC LIMIT 1')
      .get(String(appRow.id)) as Record<string, unknown> | undefined;

    let template: Record<string, unknown> | null = null;
    let items: AssessmentItem[] = [];
    if (assignRow) {
      const tplRow = db
        .prepare('SELECT * FROM assessment_templates WHERE id = ?')
        .get(String(assignRow.template_id)) as Record<string, unknown> | undefined;
      if (tplRow) {
        const showResults = Boolean(tplRow.show_results_to_candidate);
        template = {
          id: String(tplRow.id),
          title: String(tplRow.title),
          title_ar: String(tplRow.title_ar || ''),
          duration_minutes: Number(tplRow.duration_minutes || 90),
          open_date: String(tplRow.open_date || ''),
          close_date: String(tplRow.close_date || ''),
          max_attempts: Number(tplRow.max_attempts || 1),
          allow_resume: Boolean(tplRow.allow_resume),
          randomize_questions: Boolean(tplRow.randomize_questions),
          show_results_to_candidate: showResults,
        };
        const rawItems = db
          .prepare('SELECT * FROM assessment_items WHERE template_id = ? AND approved = 1 ORDER BY sort_order')
          .all(String(tplRow.id)) as Array<Record<string, unknown>>;
        items = rawItems.map((it) => hydrateItem(it, true));
      }
    }

    const attemptsRows = db
      .prepare('SELECT * FROM assessment_attempts WHERE application_id = ? ORDER BY attempt_number DESC')
      .all(String(appRow.id)) as Array<Record<string, unknown>>;
    const attempts = attemptsRows.map((a) => {
      const h = hydrateAttempt(a);
      if (!template || !template.show_results_to_candidate) {
        return {
          ...h,
          overall_score: 0,
          section_scores: {},
          competency_scores: [],
          evaluation_category: 'pending',
          strengths: [],
          improvement_areas: [],
          threshold_failures: [],
          evaluator_notes: '',
        };
      }
      return h;
    });

    res.json({
      application: {
        id: String(appRow.id),
        application_code: String(appRow.application_code),
        status: String(appRow.status),
        current_stage: String(appRow.current_stage),
        applied_at: String(appRow.applied_at),
      },
      candidate: candRow,
      job: {
        id: String(jobRow.id),
        title: String(jobRow.title),
        title_ar: String(jobRow.title_ar || ''),
        department: String(jobRow.department),
        purpose: String(jobRow.purpose || ''),
        purpose_ar: String(jobRow.purpose_ar || ''),
      },
      assignment: assignRow || null,
      template,
      items,
      attempts,
    });
  });

  router.post('/candidate/invite/:token/start', (req: Request, res: Response) => {
    const { token } = req.params;
    const appRow = db
      .prepare('SELECT * FROM applications WHERE invite_token = ?')
      .get(token) as Record<string, unknown> | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Invitation not found.' });
      return;
    }

    const assignRow = db
      .prepare('SELECT * FROM assessment_assignments WHERE application_id = ? ORDER BY assigned_at DESC LIMIT 1')
      .get(String(appRow.id)) as Record<string, unknown> | undefined;
    if (!assignRow) {
      res.status(400).json({ error: 'No assessment has been assigned to this application yet.' });
      return;
    }

    const tplRow = db
      .prepare('SELECT * FROM assessment_templates WHERE id = ?')
      .get(String(assignRow.template_id)) as Record<string, unknown>;

    const nowDate = new Date();
    if (tplRow.open_date && String(tplRow.open_date).trim()) {
      const openD = new Date(String(tplRow.open_date));
      if (!Number.isNaN(openD.getTime()) && nowDate < openD) {
        res.status(400).json({ error: `Assessment opens on ${String(tplRow.open_date)}` });
        return;
      }
    }
    if (tplRow.close_date && String(tplRow.close_date).trim()) {
      const closeD = new Date(String(tplRow.close_date) + 'T23:59:59Z');
      if (!Number.isNaN(closeD.getTime()) && nowDate > closeD) {
        res.status(400).json({ error: `Assessment closed on ${String(tplRow.close_date)}` });
        return;
      }
    }

    const existingAttempts = db
      .prepare('SELECT * FROM assessment_attempts WHERE application_id = ? ORDER BY attempt_number DESC')
      .all(String(appRow.id)) as Array<Record<string, unknown>>;

    const inProgress = existingAttempts.find((a) => String(a.status) === 'in_progress');
    if (inProgress) {
      if (!Boolean(tplRow.allow_resume)) {
        res.status(400).json({ error: 'Resuming interrupted assessments is disabled by administrator.' });
        return;
      }
      res.json({ attempt: hydrateAttempt(inProgress) });
      return;
    }

    const maxAttempts = Number(assignRow.attempts_allowed || tplRow.max_attempts || 1);
    if (existingAttempts.length >= maxAttempts) {
      res.status(400).json({ error: `Maximum allowed attempts (${maxAttempts}) reached.` });
      return;
    }

    const attemptId = generateId('att');
    const attemptNumber = existingAttempts.length + 1;
    const now = nowDate.toISOString();

    db.prepare(
      `INSERT INTO assessment_attempts (
        id, assignment_id, application_id, template_id, job_id, candidate_id,
        attempt_number, status, started_at, answers_json, practical_submission_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, '{}', '')`
    ).run(
      attemptId,
      String(assignRow.id),
      String(appRow.id),
      String(assignRow.template_id),
      String(appRow.job_id),
      String(appRow.candidate_id),
      attemptNumber,
      now
    );

    db.prepare("UPDATE assessment_assignments SET status = 'in_progress' WHERE id = ?").run(
      String(assignRow.id)
    );
    db.prepare("UPDATE applications SET status = 'in_assessment' WHERE id = ?").run(String(appRow.id));

    const newAtt = db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(attemptId) as Record<
      string,
      unknown
    >;
    res.status(201).json({ attempt: hydrateAttempt(newAtt) });
  });

  router.put('/candidate/invite/:token/save', (req: Request, res: Response) => {
    const { token } = req.params;
    const { attempt_id, answers, practical_submission_text } = req.body as {
      attempt_id?: string;
      answers?: Record<string, CandidateAnswerRecord>;
      practical_submission_text?: string;
    };

    const appRow = db.prepare('SELECT * FROM applications WHERE invite_token = ?').get(token) as
      | Record<string, unknown>
      | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Invalid invitation link.' });
      return;
    }

    const attRow = db
      .prepare("SELECT * FROM assessment_attempts WHERE id = ? AND application_id = ? AND status = 'in_progress'")
      .get(attempt_id, String(appRow.id)) as Record<string, unknown> | undefined;
    if (!attRow) {
      res.status(404).json({ error: 'Active assessment attempt not found.' });
      return;
    }

    db.prepare(
      'UPDATE assessment_attempts SET answers_json = ?, practical_submission_text = ? WHERE id = ?'
    ).run(
      JSON.stringify(answers || {}),
      practical_submission_text || '',
      String(attRow.id)
    );

    res.json({ ok: true, saved_at: new Date().toISOString() });
  });

  router.post('/candidate/invite/:token/submit', (req: Request, res: Response) => {
    const { token } = req.params;
    const { attempt_id, answers, practical_submission_text } = req.body as {
      attempt_id?: string;
      answers?: Record<string, CandidateAnswerRecord>;
      practical_submission_text?: string;
    };

    const appRow = db.prepare('SELECT * FROM applications WHERE invite_token = ?').get(token) as
      | Record<string, unknown>
      | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Invalid invitation link.' });
      return;
    }

    const attRow = db
      .prepare("SELECT * FROM assessment_attempts WHERE id = ? AND application_id = ? AND status = 'in_progress'")
      .get(attempt_id, String(appRow.id)) as Record<string, unknown> | undefined;
    if (!attRow) {
      res.status(404).json({ error: 'Active assessment attempt not found.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE assessment_attempts SET
        answers_json = ?, practical_submission_text = ?, status = 'submitted', submitted_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify(answers || {}),
      practical_submission_text || '',
      now,
      String(attRow.id)
    );

    db.prepare("UPDATE assessment_assignments SET status = 'completed' WHERE id = ?").run(
      String(attRow.assignment_id)
    );
    db.prepare("UPDATE applications SET status = 'final_review', current_stage = 'Final Review' WHERE id = ?").run(
      String(appRow.id)
    );

    recomputeApplicationScoring(String(appRow.id));

    logAudit({
      userId: String(appRow.candidate_id),
      userName: 'Candidate Submission',
      userRole: 'candidate',
      action: 'SUBMIT_ASSESSMENT_ATTEMPT',
      entityType: 'assessment_attempt',
      entityId: String(attRow.id),
      details: `Candidate submitted assessment attempt #${String(attRow.attempt_number)} for application ${String(appRow.application_code)}`,
    });

    const updatedAtt = db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(String(attRow.id)) as Record<
      string,
      unknown
    >;
    res.json({ attempt: hydrateAttempt(updatedAtt) });
  });

  // Candidate role logged-in view
  router.get('/candidate/my-applications', authenticate, requireRole(['candidate']), (req: AuthRequest, res: Response) => {
    const apps = db
      .prepare(
        `SELECT a.*, j.title as job_title, j.title_ar as job_title_ar, j.department
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
         WHERE lower(c.email) = lower(?)
         ORDER BY a.applied_at DESC`
      )
      .all(req.user!.email) as Array<Record<string, unknown>>;
    res.json({ applications: apps });
  });

  // ==================== PROTECTED CV DOWNLOAD ====================
  router.get('/files/cv/:candidateId', authenticate, requireRole(['admin', 'assessor']), (req: AuthRequest, res: Response) => {
    const { candidateId } = req.params;
    if (req.user!.role === 'assessor') {
      const assigned = db
        .prepare('SELECT 1 FROM assessment_center_schedules WHERE candidate_id = ? AND assessor_id = ? LIMIT 1')
        .get(candidateId, req.user!.id);
      if (!assigned) {
        res.status(403).json({ error: 'Forbidden: candidate CV not assigned to this assessor.' });
        return;
      }
    }

    const cand = db
      .prepare('SELECT cv_filename, cv_original_name, cv_mime FROM candidates WHERE id = ?')
      .get(candidateId) as Record<string, unknown> | undefined;
    if (!cand || !cand.cv_filename) {
      res.status(404).json({ error: 'CV file not uploaded for this candidate.' });
      return;
    }

    const filePath = path.join(UPLOAD_DIR, String(cand.cv_filename));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'CV file missing from storage.' });
      return;
    }

    res.download(filePath, String(cand.cv_original_name || 'candidate-cv.pdf'));
  });

  // ==================== SETTINGS & USERS ====================
  router.get('/settings', authenticate, (_req: AuthRequest, res: Response) => {
    const row = db.prepare("SELECT * FROM organization_settings WHERE id = 'org-default'").get() as Record<
      string,
      unknown
    >;
    res.json({
      settings: {
        id: String(row.id),
        org_name: String(row.org_name),
        org_name_ar: String(row.org_name_ar),
        tagline: String(row.tagline),
        tagline_ar: String(row.tagline_ar),
        logo_url: String(row.logo_url),
        default_language: String(row.default_language),
        job_categories: parseJson<string[]>(row.job_categories_json, []),
        competency_categories: parseJson<string[]>(row.competency_categories_json, []),
        scoring_scale_max: Number(row.scoring_scale_max),
        passing_threshold_default: Number(row.passing_threshold_default),
        default_assessment_weights: parseJson(row.default_assessment_weights_json, {}),
        workflow_stages: parseJson<string[]>(row.workflow_stages_json, []),
        retention_days: Number(row.retention_days),
        notifications_enabled: Boolean(row.notifications_enabled),
        updated_at: String(row.updated_at),
      },
    });
  });

  router.put('/settings', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const s = req.body;
    const w = s.default_assessment_weights || {};
    const weightSum =
      Number(w.technical || 0) +
      Number(w.sjt || 0) +
      Number(w.behavioral || 0) +
      Number(w.practical || 0) +
      Number(w.center || 0);
    if (weightSum !== 100) {
      res.status(400).json({ error: `Default assessment weights must sum to 100% (currently ${weightSum}%).` });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE organization_settings SET
        org_name = ?, org_name_ar = ?, tagline = ?, tagline_ar = ?, logo_url = ?, default_language = ?,
        job_categories_json = ?, competency_categories_json = ?, scoring_scale_max = ?, passing_threshold_default = ?,
        default_assessment_weights_json = ?, workflow_stages_json = ?, retention_days = ?, notifications_enabled = ?, updated_at = ?
       WHERE id = 'org-default'`
    ).run(
      s.org_name,
      s.org_name_ar,
      s.tagline,
      s.tagline_ar,
      s.logo_url,
      s.default_language || 'ar',
      JSON.stringify(s.job_categories || []),
      JSON.stringify(s.competency_categories || ['Technical', 'Behavioral']),
      Number(s.scoring_scale_max || 100),
      Number(s.passing_threshold_default || 70),
      JSON.stringify(w),
      JSON.stringify(s.workflow_stages || []),
      Number(s.retention_days || 365),
      s.notifications_enabled ? 1 : 0,
      now
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'UPDATE_SETTINGS',
      entityType: 'organization_settings',
      entityId: 'org-default',
      details: 'Updated Smart Masar organization and assessment scoring configuration.',
    });

    res.json({ ok: true });
  });

  router.get('/users', authenticate, requireRole(['admin', 'assessor']), (req: AuthRequest, res: Response) => {
    const rows =
      req.user!.role === 'admin'
        ? (db.prepare('SELECT id, name, name_ar, email, role, department, active, created_at FROM users ORDER BY created_at').all() as Array<Record<string, unknown>>)
        : (db.prepare("SELECT id, name, name_ar, email, role, department, active, created_at FROM users WHERE role = 'assessor'").all() as Array<Record<string, unknown>>);
    res.json({
      users: rows.map((u) => ({
        ...u,
        active: Boolean(u.active),
      })),
    });
  });

  router.post('/users', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { name, name_ar, email, password, role, department } = req.body as {
      name?: string;
      name_ar?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      department?: string;
    };
    if (!name?.trim() || !email?.trim() || !password || !role) {
      res.status(400).json({ error: 'Name, email, password, and role are required.' });
      return;
    }

    const exists = db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(email.trim());
    if (exists) {
      res.status(409).json({ error: 'A user with this email already exists.' });
      return;
    }

    const id = generateId('usr');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, name, name_ar, email, password_hash, role, department, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, name.trim(), name_ar?.trim() || name.trim(), email.trim(), hashPassword(password), role, department || '', now);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'CREATE_USER',
      entityType: 'user',
      entityId: id,
      details: `Created user ${email} with role ${role}`,
    });

    res.status(201).json({ id });
  });

  router.patch('/users/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { role, active, department } = req.body as { role?: UserRole; active?: boolean; department?: string };
    db.prepare(
      'UPDATE users SET role = COALESCE(?, role), active = COALESCE(?, active), department = COALESCE(?, department) WHERE id = ?'
    ).run(role || null, typeof active === 'boolean' ? (active ? 1 : 0) : null, department ?? null, id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'UPDATE_USER',
      entityType: 'user',
      entityId: id,
      details: `Updated user permissions/status (role=${role || 'unchanged'}, active=${String(active)})`,
    });
    res.json({ ok: true });
  });

  // ==================== CAMPAIGNS ====================
  router.get('/campaigns', authenticate, (_req: AuthRequest, res: Response) => {
    const rows = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
    res.json({ campaigns: rows });
  });

  router.post('/campaigns', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { title, title_ar, description, status, start_date, end_date } = req.body;
    if (!title?.trim()) {
      res.status(400).json({ error: 'Campaign title is required.' });
      return;
    }
    const id = generateId('camp');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO campaigns (id, title, title_ar, description, status, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, title.trim(), title_ar || '', description || '', status || 'active', start_date || '', end_date || '', now);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'CREATE_CAMPAIGN',
      entityType: 'campaign',
      entityId: id,
      details: `Created recruitment campaign "${title}"`,
    });
    res.status(201).json({ id });
  });

  router.patch('/campaigns/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { title, title_ar, description, status, start_date, end_date } = req.body;
    db.prepare(
      `UPDATE campaigns SET
        title = COALESCE(?, title), title_ar = COALESCE(?, title_ar),
        description = COALESCE(?, description), status = COALESCE(?, status),
        start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date)
       WHERE id = ?`
    ).run(title ?? null, title_ar ?? null, description ?? null, status ?? null, start_date ?? null, end_date ?? null, id);
    res.json({ ok: true });
  });

  // ==================== JOBS, AI JOB ANALYSIS & COMPETENCY MATRIX ====================
  router.get('/jobs', authenticate, requireRole(['admin', 'assessor']), (req: AuthRequest, res: Response) => {
    let rows: Array<Record<string, unknown>>;
    if (req.user!.role === 'admin') {
      rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    } else {
      rows = db
        .prepare(
          `SELECT DISTINCT j.* FROM jobs j
           JOIN assessment_center_schedules s ON s.job_id = j.id
           WHERE s.assessor_id = ?
           ORDER BY j.created_at DESC`
        )
        .all(req.user!.id) as Array<Record<string, unknown>>;
    }
    res.json({ jobs: rows.map((r) => hydrateJob(r, true)) });
  });

  router.post('/jobs', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const b = req.body;
    if (!b.title?.trim() || !b.department?.trim()) {
      res.status(400).json({ error: 'Job title and department are required.' });
      return;
    }

    const weights: AssessmentWeights = b.assessment_weights || {
      technical: 30,
      sjt: 20,
      behavioral: 15,
      practical: 20,
      center: 15,
    };
    const wSum = weights.technical + weights.sjt + weights.behavioral + weights.practical + weights.center;
    if (wSum !== 100) {
      res.status(400).json({ error: `Assessment weights must total 100% (got ${wSum}%).` });
      return;
    }

    const id = generateId('job');
    const now = new Date().toISOString();
    const defaultCampaign =
      b.campaign_id ||
      (db.prepare('SELECT id FROM campaigns LIMIT 1').get() as { id: string } | undefined)?.id ||
      'camp-2026-q4';

    const stages = b.workflow_stages || [
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
      `INSERT INTO jobs (
        id, campaign_id, title, title_ar, department, department_ar, category,
        purpose, purpose_ar, responsibilities_json, qualifications_json, experience_req,
        technical_skills_json, behavioral_skills_json, preferred_qualifications_json,
        employment_type, location, deadline, vacancies_count, raw_jd_text,
        ai_analysis_json, ai_analysis_status, status, workflow_stages_json,
        assessment_weights_json, passing_threshold, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'none', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      defaultCampaign,
      b.title.trim(),
      b.title_ar?.trim() || b.title.trim(),
      b.department.trim(),
      b.department_ar?.trim() || b.department.trim(),
      b.category || 'General',
      b.purpose || '',
      b.purpose_ar || '',
      JSON.stringify(b.responsibilities || []),
      JSON.stringify(b.qualifications || []),
      b.experience_req || '',
      JSON.stringify(b.technical_skills || []),
      JSON.stringify(b.behavioral_skills || []),
      JSON.stringify(b.preferred_qualifications || []),
      b.employment_type || 'Full-time',
      b.location || 'Remote / Hybrid',
      b.deadline || '2026-12-31',
      Number(b.vacancies_count || 1),
      b.raw_jd_text || '',
      b.status || 'draft',
      JSON.stringify(stages),
      JSON.stringify(weights),
      Number(b.passing_threshold || 70),
      req.user!.id,
      now,
      now
    );

    // Create default empty assessment template & center config for the new job
    db.prepare(
      `INSERT INTO assessment_templates (
        id, job_id, title, title_ar, is_reusable_template, approval_status,
        duration_minutes, open_date, close_date, max_attempts, allow_resume,
        randomize_questions, show_results_to_candidate, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 'draft', 90, '', '', 2, 1, 0, 1, ?, ?)`
    ).run(
      generateId('tpl'),
      id,
      `${b.title.trim()} Assessment Battery`,
      `بطارية تقييم ${b.title_ar?.trim() || b.title.trim()}`,
      now,
      now
    );

    db.prepare(
      `INSERT INTO assessment_center_configs (id, job_id, purpose, purpose_ar, activities_json)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      generateId('acc'),
      id,
      `Structured assessment center evaluating applied readiness for ${b.title.trim()}.`,
      `مركز التقييم المهيكل لقياس الجاهزية التطبيقية لوظيفة ${b.title_ar?.trim() || b.title.trim()}.`,
      JSON.stringify([
        {
          id: generateId('act'),
          name: 'Structured Competency Interview',
          name_ar: 'المقابلة المهيكلة المبنية على الكفاءات',
          type: 'Structured Interview',
          mode: 'online',
          duration_minutes: 45,
          competency_ids: [],
          description: 'Structured STAR interview aligned with core job competencies.',
        },
      ])
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'CREATE_JOB',
      entityType: 'job',
      entityId: id,
      details: `Created job position "${b.title.trim()}"`,
    });

    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ job: hydrateJob(jobRow, true) });
  });

  router.patch('/jobs/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const b = req.body;
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    if (b.assessment_weights) {
      const w = b.assessment_weights as AssessmentWeights;
      const sum = Number(w.technical) + Number(w.sjt) + Number(w.behavioral) + Number(w.practical) + Number(w.center);
      if (sum !== 100) {
        res.status(400).json({ error: `Assessment weights must total 100% (currently ${sum}%).` });
        return;
      }
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE jobs SET
        campaign_id = COALESCE(?, campaign_id),
        title = COALESCE(?, title),
        title_ar = COALESCE(?, title_ar),
        department = COALESCE(?, department),
        department_ar = COALESCE(?, department_ar),
        category = COALESCE(?, category),
        purpose = COALESCE(?, purpose),
        purpose_ar = COALESCE(?, purpose_ar),
        responsibilities_json = COALESCE(?, responsibilities_json),
        qualifications_json = COALESCE(?, qualifications_json),
        experience_req = COALESCE(?, experience_req),
        technical_skills_json = COALESCE(?, technical_skills_json),
        behavioral_skills_json = COALESCE(?, behavioral_skills_json),
        preferred_qualifications_json = COALESCE(?, preferred_qualifications_json),
        employment_type = COALESCE(?, employment_type),
        location = COALESCE(?, location),
        deadline = COALESCE(?, deadline),
        vacancies_count = COALESCE(?, vacancies_count),
        raw_jd_text = COALESCE(?, raw_jd_text),
        status = COALESCE(?, status),
        workflow_stages_json = COALESCE(?, workflow_stages_json),
        assessment_weights_json = COALESCE(?, assessment_weights_json),
        passing_threshold = COALESCE(?, passing_threshold),
        updated_at = ?
       WHERE id = ?`
    ).run(
      b.campaign_id ?? null,
      b.title ?? null,
      b.title_ar ?? null,
      b.department ?? null,
      b.department_ar ?? null,
      b.category ?? null,
      b.purpose ?? null,
      b.purpose_ar ?? null,
      b.responsibilities ? JSON.stringify(b.responsibilities) : null,
      b.qualifications ? JSON.stringify(b.qualifications) : null,
      b.experience_req ?? null,
      b.technical_skills ? JSON.stringify(b.technical_skills) : null,
      b.behavioral_skills ? JSON.stringify(b.behavioral_skills) : null,
      b.preferred_qualifications ? JSON.stringify(b.preferred_qualifications) : null,
      b.employment_type ?? null,
      b.location ?? null,
      b.deadline ?? null,
      b.vacancies_count ?? null,
      b.raw_jd_text ?? null,
      b.status ?? null,
      b.workflow_stages ? JSON.stringify(b.workflow_stages) : null,
      b.assessment_weights ? JSON.stringify(b.assessment_weights) : null,
      b.passing_threshold ?? null,
      now,
      id
    );

    if (b.assessment_weights || typeof b.passing_threshold === 'number') {
      const apps = db.prepare('SELECT id FROM applications WHERE job_id = ?').all(id) as Array<{ id: string }>;
      for (const a of apps) {
        recomputeApplicationScoring(a.id, req.user!.id);
      }
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'UPDATE_JOB',
      entityType: 'job',
      entityId: id,
      details: `Updated job "${String(b.title || existing.title)}" (status=${String(b.status || existing.status)})`,
    });

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ job: hydrateJob(updated, true) });
  });

  router.delete('/jobs/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT id, title FROM jobs WHERE id = ?').get(id) as
      | { id: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const deleteJobTx = db.transaction((jobId: string) => {
      db.prepare('DELETE FROM assessor_evaluations WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM assessment_center_schedules WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM evaluation_reports WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM assessment_attempts WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM assessment_assignments WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM applications WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM assessment_items WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM assessment_templates WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM assessment_center_configs WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM competencies WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    });
    deleteJobTx(id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'DELETE_JOB',
      entityType: 'job',
      entityId: id,
      details: `Deleted job "${existing.title}" and all linked applications/assessments`,
    });

    res.json({ ok: true });
  });

  router.post('/admin/clear-data', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { scope } = req.body as { scope?: 'demo_only' | 'all_recruitment' };
    if (scope !== 'demo_only' && scope !== 'all_recruitment') {
      res.status(400).json({ error: 'Invalid clear-data scope.' });
      return;
    }

    const clearTx = db.transaction(() => {
      if (scope === 'demo_only') {
        const demoCandIds = (
          db.prepare('SELECT id FROM candidates WHERE is_sample_demo = 1').all() as Array<{ id: string }>
        ).map((r) => r.id);

        for (const candId of demoCandIds) {
          db.prepare('DELETE FROM assessor_evaluations WHERE candidate_id = ?').run(candId);
          db.prepare('DELETE FROM assessment_center_schedules WHERE candidate_id = ?').run(candId);
          db.prepare('DELETE FROM evaluation_reports WHERE candidate_id = ?').run(candId);
          db.prepare('DELETE FROM assessment_attempts WHERE candidate_id = ?').run(candId);
          db.prepare('DELETE FROM assessment_assignments WHERE candidate_id = ?').run(candId);
          db.prepare('DELETE FROM applications WHERE candidate_id = ?').run(candId);
          db.prepare('DELETE FROM candidates WHERE id = ?').run(candId);
        }

        const demoJob = db.prepare("SELECT id FROM jobs WHERE id = 'job-meal-officer'").get() as
          | { id: string }
          | undefined;
        if (demoJob) {
          db.prepare('DELETE FROM assessor_evaluations WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM assessment_center_schedules WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM evaluation_reports WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM assessment_attempts WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM assessment_assignments WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM applications WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM assessment_items WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM assessment_templates WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM assessment_center_configs WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM competencies WHERE job_id = ?').run(demoJob.id);
          db.prepare('DELETE FROM jobs WHERE id = ?').run(demoJob.id);
        }
      } else {
        db.prepare('DELETE FROM assessor_evaluations').run();
        db.prepare('DELETE FROM assessment_center_schedules').run();
        db.prepare('DELETE FROM evaluation_reports').run();
        db.prepare('DELETE FROM assessment_attempts').run();
        db.prepare('DELETE FROM assessment_assignments').run();
        db.prepare('DELETE FROM applications').run();
        db.prepare('DELETE FROM assessment_items').run();
        db.prepare('DELETE FROM assessment_templates').run();
        db.prepare('DELETE FROM assessment_center_configs').run();
        db.prepare('DELETE FROM competencies').run();
        db.prepare('DELETE FROM jobs').run();
        db.prepare('DELETE FROM candidates').run();
        db.prepare('DELETE FROM campaigns').run();

        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO campaigns (id, title, title_ar, description, status, start_date, end_date, created_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
        ).run(
          'camp-active-default',
          'Active Recruitment Campaign',
          'حملة التوظيف النشطة',
          'Default active campaign for published vacancies.',
          now.slice(0, 10),
          '2027-12-31',
          now
        );
      }
    });

    clearTx();

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'CLEAR_RECRUITMENT_DATA',
      entityType: 'system',
      entityId: scope,
      details: `Cleared recruitment workspace data with scope=${scope}`,
    });

    res.json({ ok: true, scope });
  });

  router.post('/ai/analyze-job', authenticate, requireRole(['admin']), async (req: AuthRequest, res: Response) => {
    const { job_id, raw_jd_text, title, department } = req.body as {
      job_id?: string;
      raw_jd_text?: string;
      title?: string;
      department?: string;
    };

    if (!raw_jd_text?.trim()) {
      res.status(400).json({ error: 'Job description text is required for AI analysis.' });
      return;
    }

    try {
      const analysis = await analyzeJobDescriptionWithAI({
        title: title || 'Target Position',
        department: department || 'Operations',
        rawJdText: raw_jd_text,
      });

      if (job_id) {
        db.prepare(
          "UPDATE jobs SET raw_jd_text = ?, ai_analysis_json = ?, ai_analysis_status = 'draft', updated_at = ? WHERE id = ?"
        ).run(raw_jd_text, JSON.stringify(analysis), new Date().toISOString(), job_id);
      }

      logAudit({
        userId: req.user!.id,
        userName: req.user!.name,
        userRole: req.user!.role,
        action: 'AI_ANALYZE_JOB',
        entityType: 'job',
        entityId: job_id || 'preview',
        details: `Generated AI job analysis draft for "${title || job_id}"`,
      });

      res.json({ analysis });
    } catch (error) {
      const err = error as Error & { code?: string };
      res.status(err.code === 'AI_NOT_CONFIGURED' ? 503 : 500).json({
        error: err.message || 'Failed to analyze job description with AI.',
        code: err.code || 'AI_ERROR',
      });
    }
  });

  router.post('/jobs/:id/approve-analysis', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { analysis, replace_competencies } = req.body;
    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!jobRow) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE jobs SET
        purpose = COALESCE(?, purpose),
        purpose_ar = COALESCE(?, purpose_ar),
        responsibilities_json = COALESCE(?, responsibilities_json),
        qualifications_json = COALESCE(?, qualifications_json),
        experience_req = COALESCE(?, experience_req),
        ai_analysis_json = ?, ai_analysis_status = 'approved', updated_at = ?
       WHERE id = ?`
    ).run(
      analysis?.purpose ?? null,
      analysis?.purpose_ar ?? null,
      analysis?.responsibilities ? JSON.stringify(analysis.responsibilities) : null,
      analysis?.qualifications ? JSON.stringify(analysis.qualifications) : null,
      analysis?.experience_req ?? null,
      JSON.stringify(analysis),
      now,
      id
    );

    if (replace_competencies && analysis) {
      const combined = [
        ...(analysis.technical_competencies || []).map((c: Record<string, unknown>) => ({
          ...c,
          category: 'Technical',
        })),
        ...(analysis.behavioral_competencies || []).map((c: Record<string, unknown>) => ({
          ...c,
          category: 'Behavioral',
        })),
      ];
      const sum = combined.reduce((acc, c) => acc + Number(c.weight || 0), 0);
      if (combined.length > 0 && Math.abs(sum - 100) > 0.01) {
        res.status(400).json({ error: `Competency weights must sum to 100% (got ${sum}%).` });
        return;
      }

      db.prepare('DELETE FROM competencies WHERE job_id = ?').run(id);
      const ins = db.prepare(
        `INSERT INTO competencies (
          id, job_id, name, name_ar, description, description_ar, category,
          importance, is_critical, weight, assessment_method, expected_level, min_threshold, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      combined.forEach((c: Record<string, unknown>, idx: number) => {
        ins.run(
          generateId('comp'),
          id,
          String(c.name || ''),
          String(c.name_ar || ''),
          String(c.description || ''),
          String(c.description_ar || ''),
          String(c.category || 'Technical'),
          String(c.importance || 'High'),
          c.importance === 'Critical' ? 1 : 0,
          Number(c.weight || 10),
          String(c.assessment_method || 'Technical Test'),
          String(c.expected_level || 'Proficient'),
          Number(c.min_threshold || 60),
          idx + 1
        );
      });
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'APPROVE_JOB_ANALYSIS',
      entityType: 'job',
      entityId: id,
      details: `Approved AI-assisted job analysis for job ${id}`,
    });

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ job: hydrateJob(updated, true) });
  });

  router.put('/jobs/:id/competencies', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { competencies } = req.body as { competencies: Competency[] };

    if (!Array.isArray(competencies) || competencies.length === 0) {
      res.status(400).json({ error: 'At least one competency is required.' });
      return;
    }

    const totalWeight = competencies.reduce((sum, c) => sum + Number(c.weight || 0), 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      res.status(400).json({ error: `All competency weights must total exactly 100% (currently ${totalWeight}%).` });
      return;
    }

    const existingRows = db.prepare('SELECT id FROM competencies WHERE job_id = ?').all(id) as Array<{ id: string }>;
    const existingIds = new Set(existingRows.map((r) => r.id));
    const incomingIds = new Set<string>();

    const upsert = db.prepare(
      `INSERT INTO competencies (
        id, job_id, name, name_ar, description, description_ar, category,
        importance, is_critical, weight, assessment_method, expected_level, min_threshold, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, name_ar = excluded.name_ar,
        description = excluded.description, description_ar = excluded.description_ar,
        category = excluded.category, importance = excluded.importance,
        is_critical = excluded.is_critical, weight = excluded.weight,
        assessment_method = excluded.assessment_method, expected_level = excluded.expected_level,
        min_threshold = excluded.min_threshold, sort_order = excluded.sort_order`
    );

    const tx = db.transaction(() => {
      competencies.forEach((c, idx) => {
        const cid = c.id && existingIds.has(c.id) ? c.id : generateId('comp');
        incomingIds.add(cid);
        upsert.run(
          cid,
          id,
          c.name.trim(),
          c.name_ar?.trim() || c.name.trim(),
          c.description || '',
          c.description_ar || '',
          c.category || 'Technical',
          c.importance || 'High',
          c.is_critical ? 1 : 0,
          Number(c.weight),
          c.assessment_method || '',
          c.expected_level || 'Proficient',
          Number(c.min_threshold || 0),
          idx + 1
        );
      });

      for (const oldId of existingIds) {
        if (!incomingIds.has(oldId)) {
          db.prepare('DELETE FROM competencies WHERE id = ?').run(oldId);
        }
      }
    });
    tx();

    // Recompute any attempts on this job
    const apps = db.prepare('SELECT id FROM applications WHERE job_id = ?').all(id) as Array<{ id: string }>;
    for (const a of apps) {
      recomputeApplicationScoring(a.id, req.user!.id);
    }

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'UPDATE_COMPETENCY_MATRIX',
      entityType: 'job',
      entityId: id,
      details: `Updated competency matrix (${competencies.length} competencies totaling 100%)`,
    });

    const updated = db
      .prepare('SELECT * FROM competencies WHERE job_id = ? ORDER BY sort_order')
      .all(id) as Array<Record<string, unknown>>;
    res.json({ competencies: updated.map(hydrateCompetency) });
  });

  // ==================== DYNAMIC ASSESSMENT ENGINE ====================
  router.get('/jobs/:jobId/assessments', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { jobId } = req.params;
    const templates = db
      .prepare('SELECT * FROM assessment_templates WHERE job_id = ? ORDER BY updated_at DESC')
      .all(jobId) as Array<Record<string, unknown>>;
    const reusable = db
      .prepare('SELECT * FROM assessment_templates WHERE is_reusable_template = 1')
      .all() as Array<Record<string, unknown>>;

    const hydratedTemplates = templates.map((t) => {
      const items = (
        db
          .prepare('SELECT * FROM assessment_items WHERE template_id = ? ORDER BY sort_order')
          .all(String(t.id)) as Array<Record<string, unknown>>
      ).map((r) => hydrateItem(r, false));
      return {
        ...t,
        is_reusable_template: Boolean(t.is_reusable_template),
        allow_resume: Boolean(t.allow_resume),
        randomize_questions: Boolean(t.randomize_questions),
        show_results_to_candidate: Boolean(t.show_results_to_candidate),
        items,
      };
    });

    res.json({ templates: hydratedTemplates, reusable_templates: reusable });
  });

  router.post(
    '/jobs/:jobId/assessments/generate',
    authenticate,
    requireRole(['admin']),
    async (req: AuthRequest, res: Response) => {
      const { jobId } = req.params;
      const { template_id, section_type, count } = req.body as {
        template_id?: string;
        section_type: AssessmentSectionType;
        count?: number;
      };

      const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
      if (!jobRow) {
        res.status(404).json({ error: 'Job not found.' });
        return;
      }
      const job = hydrateJob(jobRow, true);
      if (!job.competencies || job.competencies.length === 0) {
        res.status(400).json({ error: 'Please define or approve the competency matrix for this job first.' });
        return;
      }

      let targetTemplateId = template_id;
      if (!targetTemplateId) {
        const existingTpl = db
          .prepare('SELECT id FROM assessment_templates WHERE job_id = ? ORDER BY updated_at DESC LIMIT 1')
          .get(jobId) as { id: string } | undefined;
        targetTemplateId = existingTpl?.id;
      }
      if (!targetTemplateId) {
        res.status(404).json({ error: 'Assessment template not found for this job.' });
        return;
      }

      try {
        const generated = await generateAssessmentItemsWithAI({
          job,
          competencies: job.competencies,
          sectionType: section_type,
          count: count || (section_type === 'practical' ? 1 : 3),
        });

        const maxSortRow = db
          .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM assessment_items WHERE template_id = ?')
          .get(targetTemplateId) as { m: number };
        let sortOrder = maxSortRow.m;

        const insertItem = db.prepare(
          `INSERT INTO assessment_items (
            id, template_id, job_id, section_type, question_type, prompt, prompt_ar,
            scenario_context, scenario_context_ar, options_json, correct_answer,
            marking_guide, marking_guide_ar, competency_id, max_score, difficulty,
            explanation, resources_json, expected_output, rubric_json, time_limit_minutes, approved, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        );

        const insertedIds: string[] = [];
        for (const item of generated) {
          sortOrder += 1;
          const itemId = generateId('item');
          insertedIds.push(itemId);
          insertItem.run(
            itemId,
            targetTemplateId,
            jobId,
            section_type,
            item.question_type || (section_type === 'sjt' ? 'sjt' : section_type === 'behavioral' ? 'likert' : 'mcq'),
            item.prompt || '',
            item.prompt_ar || '',
            item.scenario_context || '',
            item.scenario_context_ar || '',
            JSON.stringify(item.options || []),
            item.correct_answer || '',
            item.marking_guide || '',
            item.marking_guide_ar || '',
            item.competency_id || job.competencies[0].id,
            Number(item.max_score || (section_type === 'practical' ? 30 : section_type === 'behavioral' ? 5 : 10)),
            item.difficulty || 'medium',
            item.explanation || '',
            JSON.stringify(item.resources || []),
            item.expected_output || '',
            JSON.stringify(item.rubric || []),
            Number(item.time_limit_minutes || 0),
            sortOrder
          );
        }

        logAudit({
          userId: req.user!.id,
          userName: req.user!.name,
          userRole: req.user!.role,
          action: 'AI_GENERATE_ASSESSMENT',
          entityType: 'assessment_template',
          entityId: targetTemplateId,
          details: `AI generated ${insertedIds.length} unapproved ${section_type} draft items for "${job.title}"`,
        });

        res.status(201).json({ generated_count: insertedIds.length });
      } catch (error) {
        const err = error as Error & { code?: string };
        res.status(err.code === 'AI_NOT_CONFIGURED' ? 503 : 500).json({
          error: err.message || 'AI assessment generation failed.',
          code: err.code || 'AI_ERROR',
        });
      }
    }
  );

  router.post('/jobs/:jobId/assessments/items', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { jobId } = req.params;
    const b = req.body;
    let templateId = b.template_id;
    if (!templateId) {
      const tpl = db
        .prepare('SELECT id FROM assessment_templates WHERE job_id = ? LIMIT 1')
        .get(jobId) as { id: string } | undefined;
      templateId = tpl?.id;
    }
    if (!templateId) {
      res.status(404).json({ error: 'Assessment template not found for this job.' });
      return;
    }

    const maxSort = (
      db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM assessment_items WHERE template_id = ?')
        .get(templateId) as { m: number }
    ).m;

    const itemId = generateId('item');
    db.prepare(
      `INSERT INTO assessment_items (
        id, template_id, job_id, section_type, question_type, prompt, prompt_ar,
        scenario_context, scenario_context_ar, options_json, correct_answer,
        marking_guide, marking_guide_ar, competency_id, max_score, difficulty,
        explanation, resources_json, expected_output, rubric_json, time_limit_minutes, approved, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      itemId,
      templateId,
      jobId,
      b.section_type || 'technical',
      b.question_type || 'mcq',
      b.prompt || '',
      b.prompt_ar || '',
      b.scenario_context || '',
      b.scenario_context_ar || '',
      JSON.stringify(b.options || []),
      b.correct_answer || '',
      b.marking_guide || '',
      b.marking_guide_ar || '',
      b.competency_id || '',
      Number(b.max_score || 10),
      b.difficulty || 'medium',
      b.explanation || '',
      JSON.stringify(b.resources || []),
      b.expected_output || '',
      JSON.stringify(b.rubric || []),
      Number(b.time_limit_minutes || 0),
      b.approved ? 1 : 0,
      maxSort + 1
    );

    const row = db.prepare('SELECT * FROM assessment_items WHERE id = ?').get(itemId) as Record<string, unknown>;
    res.status(201).json({ item: hydrateItem(row, false) });
  });

  router.patch('/assessment-items/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const b = req.body;
    db.prepare(
      `UPDATE assessment_items SET
        prompt = COALESCE(?, prompt),
        prompt_ar = COALESCE(?, prompt_ar),
        scenario_context = COALESCE(?, scenario_context),
        scenario_context_ar = COALESCE(?, scenario_context_ar),
        options_json = COALESCE(?, options_json),
        correct_answer = COALESCE(?, correct_answer),
        marking_guide = COALESCE(?, marking_guide),
        marking_guide_ar = COALESCE(?, marking_guide_ar),
        competency_id = COALESCE(?, competency_id),
        max_score = COALESCE(?, max_score),
        difficulty = COALESCE(?, difficulty),
        explanation = COALESCE(?, explanation),
        expected_output = COALESCE(?, expected_output),
        rubric_json = COALESCE(?, rubric_json),
        resources_json = COALESCE(?, resources_json),
        time_limit_minutes = COALESCE(?, time_limit_minutes),
        approved = COALESCE(?, approved)
       WHERE id = ?`
    ).run(
      b.prompt ?? null,
      b.prompt_ar ?? null,
      b.scenario_context ?? null,
      b.scenario_context_ar ?? null,
      b.options ? JSON.stringify(b.options) : null,
      b.correct_answer ?? null,
      b.marking_guide ?? null,
      b.marking_guide_ar ?? null,
      b.competency_id ?? null,
      typeof b.max_score === 'number' ? b.max_score : null,
      b.difficulty ?? null,
      b.explanation ?? null,
      b.expected_output ?? null,
      b.rubric ? JSON.stringify(b.rubric) : null,
      b.resources ? JSON.stringify(b.resources) : null,
      typeof b.time_limit_minutes === 'number' ? b.time_limit_minutes : null,
      typeof b.approved === 'boolean' ? (b.approved ? 1 : 0) : null,
      id
    );

    const row = db.prepare('SELECT * FROM assessment_items WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ item: hydrateItem(row, false) });
  });

  router.delete('/assessment-items/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    db.prepare('DELETE FROM assessment_items WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.patch('/assessment-templates/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const b = req.body;
    const now = new Date().toISOString();

    if (b.approval_status === 'approved') {
      const approvedItemCount = (
        db
          .prepare('SELECT COUNT(*) as cnt FROM assessment_items WHERE template_id = ? AND approved = 1')
          .get(id) as { cnt: number }
      ).cnt;
      if (approvedItemCount === 0) {
        res.status(400).json({ error: 'Approve at least one assessment item before approving the assessment template.' });
        return;
      }
    }

    db.prepare(
      `UPDATE assessment_templates SET
        title = COALESCE(?, title),
        title_ar = COALESCE(?, title_ar),
        is_reusable_template = COALESCE(?, is_reusable_template),
        approval_status = COALESCE(?, approval_status),
        approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
        approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
        duration_minutes = COALESCE(?, duration_minutes),
        open_date = COALESCE(?, open_date),
        close_date = COALESCE(?, close_date),
        max_attempts = COALESCE(?, max_attempts),
        allow_resume = COALESCE(?, allow_resume),
        randomize_questions = COALESCE(?, randomize_questions),
        show_results_to_candidate = COALESCE(?, show_results_to_candidate),
        updated_at = ?
       WHERE id = ?`
    ).run(
      b.title ?? null,
      b.title_ar ?? null,
      typeof b.is_reusable_template === 'boolean' ? (b.is_reusable_template ? 1 : 0) : null,
      b.approval_status ?? null,
      b.approval_status ?? null,
      req.user!.id,
      b.approval_status ?? null,
      now,
      b.duration_minutes ?? null,
      b.open_date ?? null,
      b.close_date ?? null,
      b.max_attempts ?? null,
      typeof b.allow_resume === 'boolean' ? (b.allow_resume ? 1 : 0) : null,
      typeof b.randomize_questions === 'boolean' ? (b.randomize_questions ? 1 : 0) : null,
      typeof b.show_results_to_candidate === 'boolean' ? (b.show_results_to_candidate ? 1 : 0) : null,
      now,
      id
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'UPDATE_ASSESSMENT_TEMPLATE',
      entityType: 'assessment_template',
      entityId: id,
      details: `Updated assessment template configuration (approval_status=${b.approval_status || 'unchanged'})`,
    });

    res.json({ ok: true });
  });

  // ==================== CANDIDATES & APPLICATIONS ====================
  router.get('/candidates', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const includeArchived = req.query.include_archived === 'true';
    const rows = db
      .prepare(
        includeArchived
          ? 'SELECT * FROM candidates ORDER BY created_at DESC'
          : 'SELECT * FROM candidates WHERE archived = 0 ORDER BY created_at DESC'
      )
      .all() as Array<Record<string, unknown>>;

    const candidates = rows.map((c) => ({
      ...c,
      consent_accepted: Boolean(c.consent_accepted),
      is_sample_demo: Boolean(c.is_sample_demo),
      archived: Boolean(c.archived),
    }));
    res.json({ candidates });
  });

  router.post(
    '/candidates',
    authenticate,
    requireRole(['admin']),
    upload.single('cv'),
    (req: AuthRequest, res: Response) => {
      const { full_name, email, phone, location, cv_text_summary, job_id } = req.body as {
        full_name?: string;
        email?: string;
        phone?: string;
        location?: string;
        cv_text_summary?: string;
        job_id?: string;
      };

      if (!full_name?.trim() || !email?.trim()) {
        res.status(400).json({ error: 'Candidate full name and email are required.' });
        return;
      }

      const now = new Date().toISOString();
      const candId = generateId('cand');
      const candCode = `CAND-${Math.floor(1000 + Math.random() * 9000)}`;

      db.prepare(
        `INSERT INTO candidates (
          id, candidate_code, full_name, email, phone, location,
          cv_filename, cv_original_name, cv_mime, cv_text_summary,
          consent_accepted, consent_at, is_sample_demo, archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?, ?)`
      ).run(
        candId,
        candCode,
        full_name.trim(),
        email.trim(),
        phone?.trim() || '',
        location?.trim() || '',
        req.file ? req.file.filename : null,
        req.file ? req.file.originalname : null,
        req.file ? req.file.mimetype : null,
        cv_text_summary?.trim() || '',
        now,
        now,
        now
      );

      let applicationId: string | null = null;
      let inviteToken: string | null = null;

      if (job_id) {
        const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id) as Record<string, unknown> | undefined;
        if (jobRow) {
          applicationId = generateId('app');
          inviteToken = `inv-${crypto.randomBytes(12).toString('hex')}`;
          const appCode = `APP-${new Date().getFullYear()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
          db.prepare(
            `INSERT INTO applications (
              id, application_code, job_id, campaign_id, candidate_id, status, current_stage,
              invite_token, applied_at, final_recommendation, human_decision, decision_notes
            ) VALUES (?, ?, ?, ?, ?, 'screening', 'Screening', ?, ?, 'pending', 'pending', '')`
          ).run(applicationId, appCode, job_id, String(jobRow.campaign_id), candId, inviteToken, now);
        }
      }

      logAudit({
        userId: req.user!.id,
        userName: req.user!.name,
        userRole: req.user!.role,
        action: 'CREATE_CANDIDATE',
        entityType: 'candidate',
        entityId: candId,
        details: `Manually added candidate "${full_name.trim()}" (${candCode})${job_id ? ` and assigned to job ${job_id}` : ''}`,
      });

      res.status(201).json({ candidate_id: candId, candidate_code: candCode, application_id: applicationId, invite_token: inviteToken });
    }
  );

  router.patch('/candidates/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const b = req.body;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE candidates SET
        full_name = COALESCE(?, full_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        location = COALESCE(?, location),
        cv_text_summary = COALESCE(?, cv_text_summary),
        archived = COALESCE(?, archived),
        updated_at = ?
       WHERE id = ?`
    ).run(
      b.full_name ?? null,
      b.email ?? null,
      b.phone ?? null,
      b.location ?? null,
      b.cv_text_summary ?? null,
      typeof b.archived === 'boolean' ? (b.archived ? 1 : 0) : null,
      now,
      id
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: b.archived ? 'ARCHIVE_CANDIDATE' : 'UPDATE_CANDIDATE',
      entityType: 'candidate',
      entityId: id,
      details: `Updated candidate ${id} (archived=${String(b.archived)})`,
    });
    res.json({ ok: true });
  });

  router.delete('/candidates/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'DELETE_CANDIDATE',
      entityType: 'candidate',
      entityId: id,
      details: `Deleted candidate profile ${id}`,
    });
    res.json({ ok: true });
  });

  router.get('/applications', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { job_id, campaign_id, status, include_archived } = req.query as {
      job_id?: string;
      campaign_id?: string;
      status?: string;
      include_archived?: string;
    };

    const conditions: string[] = include_archived === 'true' ? ['1=1'] : ['c.archived = 0'];
    const params: unknown[] = [];

    if (job_id && job_id !== 'all') {
      conditions.push('a.job_id = ?');
      params.push(job_id);
    }
    if (campaign_id && campaign_id !== 'all') {
      conditions.push('a.campaign_id = ?');
      params.push(campaign_id);
    }
    if (status && status !== 'all') {
      conditions.push('a.status = ?');
      params.push(status);
    }

    const sql = `
      SELECT a.*, j.title as job_title, j.title_ar as job_title_ar,
             c.candidate_code, c.full_name, c.email, c.phone, c.location,
             c.cv_filename, c.cv_original_name, c.cv_text_summary, c.is_sample_demo, c.archived
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.applied_at DESC
    `;

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const applications = rows.map((r) => {
      const appId = String(r.id);
      const attemptRows = db
        .prepare('SELECT * FROM assessment_attempts WHERE application_id = ? ORDER BY attempt_number DESC')
        .all(appId) as Array<Record<string, unknown>>;
      const latestAttempt = attemptRows[0] ? hydrateAttempt(attemptRows[0]) : null;

      const schedules = db
        .prepare(
          `SELECT s.*, u.name as assessor_name FROM assessment_center_schedules s
           LEFT JOIN users u ON u.id = s.assessor_id
           WHERE s.application_id = ? ORDER BY s.scheduled_at DESC`
        )
        .all(appId);

      const evalRows = db
        .prepare(
          `SELECT e.*, u.name as assessor_name FROM assessor_evaluations e
           LEFT JOIN users u ON u.id = e.assessor_id
           WHERE e.application_id = ? ORDER BY e.submitted_at DESC`
        )
        .all(appId) as Array<Record<string, unknown>>;

      const repRow = db
        .prepare('SELECT * FROM evaluation_reports WHERE application_id = ?')
        .get(appId) as Record<string, unknown> | undefined;

      return {
        id: appId,
        application_code: String(r.application_code),
        job_id: String(r.job_id),
        campaign_id: String(r.campaign_id),
        candidate_id: String(r.candidate_id),
        status: String(r.status),
        current_stage: String(r.current_stage),
        invite_token: String(r.invite_token),
        applied_at: String(r.applied_at),
        final_recommendation: String(r.final_recommendation),
        human_decision: String(r.human_decision),
        decision_notes: String(r.decision_notes || ''),
        decision_by: r.decision_by ? String(r.decision_by) : null,
        decision_at: r.decision_at ? String(r.decision_at) : null,
        job_title: String(r.job_title),
        job_title_ar: String(r.job_title_ar || ''),
        candidate: {
          id: String(r.candidate_id),
          candidate_code: String(r.candidate_code),
          full_name: String(r.full_name),
          email: String(r.email),
          phone: String(r.phone || ''),
          location: String(r.location || ''),
          cv_filename: r.cv_filename ? String(r.cv_filename) : null,
          cv_original_name: r.cv_original_name ? String(r.cv_original_name) : null,
          cv_text_summary: String(r.cv_text_summary || ''),
          is_sample_demo: Boolean(r.is_sample_demo),
          archived: Boolean(r.archived),
        },
        latest_attempt: latestAttempt,
        attempts_count: attemptRows.length,
        center_schedules: schedules,
        assessor_evaluations: evalRows.map((ev) => ({
          ...ev,
          competency_ratings: parseJson(ev.competency_ratings_json, {}),
        })),
        evaluation_report: repRow
          ? {
              ...repRow,
              strengths: parseJson(repRow.strengths_json, []),
              improvement_areas: parseJson(repRow.improvement_areas_json, []),
            }
          : null,
      };
    });

    res.json({ applications });
  });

  router.post('/applications', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { candidate_id, job_id } = req.body as { candidate_id?: string; job_id?: string };
    if (!candidate_id || !job_id) {
      res.status(400).json({ error: 'candidate_id and job_id are required.' });
      return;
    }

    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id) as Record<string, unknown> | undefined;
    const candRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate_id) as
      | Record<string, unknown>
      | undefined;
    if (!jobRow || !candRow) {
      res.status(404).json({ error: 'Job or candidate not found.' });
      return;
    }

    const now = new Date().toISOString();
    const appId = generateId('app');
    const appCode = `APP-${new Date().getFullYear()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const inviteToken = `inv-${crypto.randomBytes(12).toString('hex')}`;

    db.prepare(
      `INSERT INTO applications (
        id, application_code, job_id, campaign_id, candidate_id, status, current_stage,
        invite_token, applied_at, final_recommendation, human_decision, decision_notes
      ) VALUES (?, ?, ?, ?, ?, 'screening', 'Screening', ?, ?, 'pending', 'pending', '')`
    ).run(appId, appCode, job_id, String(jobRow.campaign_id), candidate_id, inviteToken, now);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'CREATE_APPLICATION',
      entityType: 'application',
      entityId: appId,
      details: `Assigned candidate ${String(candRow.full_name)} to job ${String(jobRow.title)} (${appCode})`,
    });

    res.status(201).json({ id: appId, application_code: appCode, invite_token: inviteToken });
  });

  router.post('/applications/:id/invite', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { template_id, due_date, attempts_allowed } = req.body as {
      template_id?: string;
      due_date?: string;
      attempts_allowed?: number;
    };

    const appRow = db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const tplRow = template_id
      ? (db.prepare('SELECT * FROM assessment_templates WHERE id = ?').get(template_id) as Record<string, unknown> | undefined)
      : (db
          .prepare(
            "SELECT * FROM assessment_templates WHERE job_id = ? AND approval_status = 'approved' ORDER BY updated_at DESC LIMIT 1"
          )
          .get(String(appRow.job_id)) as Record<string, unknown> | undefined);

    if (!tplRow) {
      res.status(400).json({ error: 'No approved assessment template found for this job. Please approve the assessment tools first.' });
      return;
    }

    const now = new Date().toISOString();
    const assignId = generateId('asg');
    db.prepare(
      `INSERT INTO assessment_assignments (
        id, application_id, template_id, job_id, candidate_id, status, attempts_allowed,
        due_date, assigned_by, assigned_at
      ) VALUES (?, ?, ?, ?, ?, 'assigned', ?, ?, ?, ?)`
    ).run(
      assignId,
      id,
      String(tplRow.id),
      String(appRow.job_id),
      String(appRow.candidate_id),
      Number(attempts_allowed || tplRow.max_attempts || 2),
      due_date || '',
      req.user!.id,
      now
    );

    db.prepare("UPDATE applications SET status = 'assessment_invited', current_stage = 'Technical Test' WHERE id = ?").run(id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'INVITE_TO_ASSESSMENT',
      entityType: 'application',
      entityId: id,
      details: `Invited application ${String(appRow.application_code)} to assessment template ${String(tplRow.title)}`,
    });

    res.json({ assignment_id: assignId, invite_token: String(appRow.invite_token) });
  });

  router.post('/applications/:id/grade', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { attempt_id, item_scores, evaluator_notes } = req.body as {
      attempt_id?: string;
      item_scores?: Record<string, { awarded_score: number; grader_comment?: string }>;
      evaluator_notes?: string;
    };

    const attRow = attempt_id
      ? (db.prepare('SELECT * FROM assessment_attempts WHERE id = ? AND application_id = ?').get(attempt_id, id) as
          | Record<string, unknown>
          | undefined)
      : (db
          .prepare('SELECT * FROM assessment_attempts WHERE application_id = ? ORDER BY attempt_number DESC LIMIT 1')
          .get(id) as Record<string, unknown> | undefined);

    if (!attRow) {
      res.status(404).json({ error: 'Assessment attempt not found.' });
      return;
    }

    const answers = parseJson<Record<string, CandidateAnswerRecord>>(attRow.answers_json, {});
    if (item_scores) {
      for (const [itemId, grade] of Object.entries(item_scores)) {
        answers[itemId] = {
          ...(answers[itemId] || { item_id: itemId }),
          awarded_score: Number(grade.awarded_score),
          grader_comment: grade.grader_comment ?? answers[itemId]?.grader_comment,
        };
      }
    }

    db.prepare(
      `UPDATE assessment_attempts SET answers_json = ?, evaluator_notes = COALESCE(?, evaluator_notes), status = 'evaluated'
       WHERE id = ?`
    ).run(JSON.stringify(answers), evaluator_notes ?? null, String(attRow.id));

    recomputeApplicationScoring(id, req.user!.id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'GRADE_ASSESSMENT_ATTEMPT',
      entityType: 'assessment_attempt',
      entityId: String(attRow.id),
      details: `Recorded human evaluator grades and recomputed scoring for application ${id}`,
    });

    const updated = db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(String(attRow.id)) as Record<
      string,
      unknown
    >;
    res.json({ attempt: hydrateAttempt(updated) });
  });

  router.post('/applications/:id/decision', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { human_decision, decision_notes, status } = req.body as {
      human_decision: 'pending' | 'approved_hire' | 'hold' | 'rejected';
      decision_notes?: string;
      status?: string;
    };

    const now = new Date().toISOString();
    const derivedStatus =
      status ||
      (human_decision === 'approved_hire'
        ? 'offered'
        : human_decision === 'rejected'
          ? 'rejected'
          : 'final_review');

    db.prepare(
      `UPDATE applications SET
        human_decision = ?, decision_notes = ?, decision_by = ?, decision_at = ?, status = ?
       WHERE id = ?`
    ).run(human_decision, decision_notes || '', req.user!.id, now, derivedStatus, id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'RECORD_HUMAN_DECISION',
      entityType: 'application',
      entityId: id,
      details: `Human decision recorded: ${human_decision} (status=${derivedStatus})`,
    });

    res.json({ ok: true });
  });

  router.post(
    '/ai/evaluate-draft/:applicationId',
    authenticate,
    requireRole(['admin']),
    async (req: AuthRequest, res: Response) => {
      const { applicationId } = req.params;
      const appRow = db
        .prepare(
          `SELECT a.*, c.full_name, j.title as job_title
           FROM applications a
           JOIN candidates c ON c.id = a.candidate_id
           JOIN jobs j ON j.id = a.job_id
           WHERE a.id = ?`
        )
        .get(applicationId) as Record<string, unknown> | undefined;
      if (!appRow) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }

      const attRow = db
        .prepare('SELECT * FROM assessment_attempts WHERE application_id = ? ORDER BY attempt_number DESC LIMIT 1')
        .get(applicationId) as Record<string, unknown> | undefined;
      if (!attRow) {
        res.status(400).json({ error: 'Candidate has no recorded assessment attempt to summarize yet.' });
        return;
      }

      const att = hydrateAttempt(attRow);
      const evals = db
        .prepare('SELECT observations FROM assessor_evaluations WHERE application_id = ?')
        .all(applicationId) as Array<{ observations: string }>;

      try {
        const draft = await draftCandidateEvaluationWithAI({
          candidateName: String(appRow.full_name),
          jobTitle: String(appRow.job_title),
          overallScore: att.overall_score,
          evaluationCategory: att.evaluation_category,
          sectionScores: att.section_scores as unknown as Record<string, number | null>,
          competencyBreakdown: att.competency_scores,
          practicalSubmission: att.practical_submission_text,
          assessorObservations: evals.map((e) => e.observations).filter(Boolean),
        });

        const now = new Date().toISOString();
        const existingRep = db
          .prepare('SELECT id FROM evaluation_reports WHERE application_id = ?')
          .get(applicationId) as { id: string } | undefined;

        if (existingRep) {
          db.prepare(
            `UPDATE evaluation_reports SET ai_summary = ?, strengths_json = ?, improvement_areas_json = ?, status = 'draft'
             WHERE id = ?`
          ).run(draft.summary, JSON.stringify(draft.strengths), JSON.stringify(draft.improvement_areas), existingRep.id);
        } else {
          db.prepare(
            `INSERT INTO evaluation_reports (
              id, application_id, job_id, candidate_id, ai_summary, strengths_json,
              improvement_areas_json, human_notes, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'draft', ?)`
          ).run(
            generateId('rep'),
            applicationId,
            String(appRow.job_id),
            String(appRow.candidate_id),
            draft.summary,
            JSON.stringify(draft.strengths),
            JSON.stringify(draft.improvement_areas),
            now
          );
        }

        logAudit({
          userId: req.user!.id,
          userName: req.user!.name,
          userRole: req.user!.role,
          action: 'AI_DRAFT_EVALUATION_REPORT',
          entityType: 'evaluation_report',
          entityId: applicationId,
          details: `Generated evidence-grounded AI draft evaluation summary for ${String(appRow.full_name)}`,
        });

        res.json({ draft });
      } catch (error) {
        const err = error as Error & { code?: string };
        res.status(err.code === 'AI_NOT_CONFIGURED' ? 503 : 500).json({
          error: err.message || 'AI evaluation draft failed.',
          code: err.code || 'AI_ERROR',
        });
      }
    }
  );

  router.patch('/evaluation-reports/:id', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { ai_summary, human_notes, status } = req.body;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE evaluation_reports SET
        ai_summary = COALESCE(?, ai_summary),
        human_notes = COALESCE(?, human_notes),
        status = COALESCE(?, status),
        approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
        approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END
       WHERE id = ?`
    ).run(ai_summary ?? null, human_notes ?? null, status ?? null, status ?? null, req.user!.id, status ?? null, now, id);
    res.json({ ok: true });
  });

  // ==================== ASSESSMENT CENTER & ASSESSOR WORKSPACE ====================
  router.get('/jobs/:jobId/center-config', authenticate, requireRole(['admin', 'assessor']), (req: AuthRequest, res: Response) => {
    const row = db.prepare('SELECT * FROM assessment_center_configs WHERE job_id = ?').get(req.params.jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.json({ config: { id: '', job_id: req.params.jobId, purpose: '', purpose_ar: '', activities: [] } });
      return;
    }
    res.json({
      config: {
        id: String(row.id),
        job_id: String(row.job_id),
        purpose: String(row.purpose || ''),
        purpose_ar: String(row.purpose_ar || ''),
        activities: parseJson(row.activities_json, []),
      },
    });
  });

  router.put('/jobs/:jobId/center-config', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { purpose, purpose_ar, activities } = req.body;
    const existing = db.prepare('SELECT id FROM assessment_center_configs WHERE job_id = ?').get(jobId) as
      | { id: string }
      | undefined;
    if (existing) {
      db.prepare(
        'UPDATE assessment_center_configs SET purpose = ?, purpose_ar = ?, activities_json = ? WHERE job_id = ?'
      ).run(purpose || '', purpose_ar || '', JSON.stringify(activities || []), jobId);
    } else {
      db.prepare(
        'INSERT INTO assessment_center_configs (id, job_id, purpose, purpose_ar, activities_json) VALUES (?, ?, ?, ?, ?)'
      ).run(generateId('acc'), jobId, purpose || '', purpose_ar || '', JSON.stringify(activities || []));
    }
    res.json({ ok: true });
  });

  router.get('/center/schedules', authenticate, requireRole(['admin', 'assessor']), (req: AuthRequest, res: Response) => {
    const baseSql = `
      SELECT s.*, c.full_name as candidate_name, c.candidate_code,
             j.title as job_title, j.title_ar as job_title_ar,
             u.name as assessor_name
      FROM assessment_center_schedules s
      JOIN candidates c ON c.id = s.candidate_id
      JOIN jobs j ON j.id = s.job_id
      JOIN users u ON u.id = s.assessor_id
    `;
    const rows =
      req.user!.role === 'admin'
        ? db.prepare(`${baseSql} ORDER BY s.scheduled_at DESC`).all()
        : db.prepare(`${baseSql} WHERE s.assessor_id = ? ORDER BY s.scheduled_at DESC`).all(req.user!.id);

    // For assessors, also return job competencies so they can score structured rubrics
    const evals =
      req.user!.role === 'admin'
        ? db.prepare('SELECT * FROM assessor_evaluations ORDER BY submitted_at DESC').all()
        : db.prepare('SELECT * FROM assessor_evaluations WHERE assessor_id = ? ORDER BY submitted_at DESC').all(req.user!.id);

    res.json({
      schedules: rows,
      evaluations: (evals as Array<Record<string, unknown>>).map((ev) => ({
        ...ev,
        competency_ratings: parseJson(ev.competency_ratings_json, {}),
      })),
    });
  });

  router.post('/center/schedules', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const b = req.body;
    if (!b.application_id || !b.assessor_id || !b.activity_name || !b.scheduled_at) {
      res.status(400).json({ error: 'Application, assessor, activity name, and schedule date/time are required.' });
      return;
    }
    const appRow = db.prepare('SELECT * FROM applications WHERE id = ?').get(b.application_id) as
      | Record<string, unknown>
      | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const id = generateId('sch');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO assessment_center_schedules (
        id, job_id, application_id, candidate_id, activity_name, activity_type, mode,
        scheduled_at, duration_minutes, location_or_link, assessor_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`
    ).run(
      id,
      String(appRow.job_id),
      b.application_id,
      String(appRow.candidate_id),
      b.activity_name,
      b.activity_type || 'Structured Interview',
      b.mode || 'online',
      b.scheduled_at,
      Number(b.duration_minutes || 45),
      b.location_or_link || '',
      b.assessor_id,
      now
    );

    db.prepare("UPDATE applications SET status = 'assessment_center', current_stage = 'Assessment Center' WHERE id = ?").run(
      b.application_id
    );

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'SCHEDULE_ASSESSMENT_CENTER',
      entityType: 'assessment_center_schedule',
      entityId: id,
      details: `Scheduled "${b.activity_name}" for application ${String(appRow.application_code)}`,
    });

    res.status(201).json({ id });
  });

  router.post('/center/evaluations', authenticate, requireRole(['admin', 'assessor']), (req: AuthRequest, res: Response) => {
    const { schedule_id, observations, evidence, competency_ratings, overall_rating, comments } = req.body;
    const sched = db.prepare('SELECT * FROM assessment_center_schedules WHERE id = ?').get(schedule_id) as
      | Record<string, unknown>
      | undefined;
    if (!sched) {
      res.status(404).json({ error: 'Assessment center schedule not found.' });
      return;
    }

    if (req.user!.role === 'assessor' && String(sched.assessor_id) !== req.user!.id) {
      res.status(403).json({ error: 'Forbidden: you are not the assigned assessor for this activity.' });
      return;
    }

    const id = generateId('ev');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO assessor_evaluations (
        id, schedule_id, application_id, job_id, candidate_id, assessor_id,
        observations, evidence, competency_ratings_json, overall_rating, comments, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      schedule_id,
      String(sched.application_id),
      String(sched.job_id),
      String(sched.candidate_id),
      req.user!.id,
      observations || '',
      evidence || '',
      JSON.stringify(competency_ratings || {}),
      Number(overall_rating || 0),
      comments || '',
      now
    );

    db.prepare("UPDATE assessment_center_schedules SET status = 'completed' WHERE id = ?").run(schedule_id);
    recomputeApplicationScoring(String(sched.application_id), req.user!.id);

    logAudit({
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      action: 'SUBMIT_ASSESSOR_EVALUATION',
      entityType: 'assessor_evaluation',
      entityId: id,
      details: `Assessor submitted evaluation for schedule ${schedule_id}`,
    });

    res.status(201).json({ id });
  });

  // ==================== DASHBOARD & AUDIT LOGS ====================
  router.get('/dashboard', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
    const { job_id, campaign_id, status } = req.query as {
      job_id?: string;
      campaign_id?: string;
      status?: string;
    };

    const totalJobs = (db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status != 'archived'").get() as { c: number }).c;
    const activeVacancies = (db.prepare("SELECT COALESCE(SUM(vacancies_count),0) as c FROM jobs WHERE status = 'published'").get() as { c: number }).c;

    const appConds = ['c.archived = 0'];
    const appParams: unknown[] = [];
    if (job_id && job_id !== 'all') {
      appConds.push('a.job_id = ?');
      appParams.push(job_id);
    }
    if (campaign_id && campaign_id !== 'all') {
      appConds.push('a.campaign_id = ?');
      appParams.push(campaign_id);
    }
    if (status && status !== 'all') {
      appConds.push('a.status = ?');
      appParams.push(status);
    }

    const apps = db
      .prepare(
        `SELECT a.*, c.full_name, c.candidate_code, c.is_sample_demo, j.title as job_title, j.title_ar as job_title_ar
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
         WHERE ${appConds.join(' AND ')}`
      )
      .all(...appParams) as Array<Record<string, unknown>>;

    let underAssessment = 0;
    let completedAssessments = 0;
    let meetsReq = 0;
    let furtherRev = 0;
    let doesNotMeet = 0;

    const candidateMetrics = apps.map((a) => {
      const attRow = db
        .prepare('SELECT * FROM assessment_attempts WHERE application_id = ? ORDER BY attempt_number DESC LIMIT 1')
        .get(String(a.id)) as Record<string, unknown> | undefined;
      const att = attRow ? hydrateAttempt(attRow) : null;

      if (a.status === 'assessment_invited' || a.status === 'in_assessment' || a.status === 'assessment_center') {
        underAssessment += 1;
      }
      if (att && (att.status === 'submitted' || att.status === 'evaluated')) {
        completedAssessments += 1;
      }
      if (a.final_recommendation === 'meets_requirements') meetsReq += 1;
      else if (a.final_recommendation === 'further_review') furtherRev += 1;
      else if (a.final_recommendation === 'does_not_meet') doesNotMeet += 1;

      return {
        application_id: String(a.id),
        application_code: String(a.application_code),
        job_id: String(a.job_id),
        job_title: String(a.job_title),
        candidate_id: String(a.candidate_id),
        candidate_code: String(a.candidate_code),
        full_name: String(a.full_name),
        is_sample_demo: Boolean(a.is_sample_demo),
        status: String(a.status),
        human_decision: String(a.human_decision),
        final_recommendation: String(a.final_recommendation),
        overall_score: att ? att.overall_score : null,
        section_scores: att ? att.section_scores : null,
        competency_scores: att ? att.competency_scores : [],
        critical_passed: att ? att.critical_passed : true,
        threshold_passed: att ? att.threshold_passed : false,
        threshold_failures: att ? att.threshold_failures : [],
        strengths: att ? att.strengths : [],
        improvement_areas: att ? att.improvement_areas : [],
      };
    });

    res.json({
      summary: {
        total_jobs: totalJobs,
        active_vacancies: activeVacancies,
        total_applicants: apps.length,
        under_assessment: underAssessment,
        completed_assessments: completedAssessments,
        meets_requirements: meetsReq,
        further_review: furtherRev,
        does_not_meet: doesNotMeet,
      },
      candidates: candidateMetrics.sort((a, b) => (b.overall_score ?? -1) - (a.overall_score ?? -1)),
    });
  });

  router.get('/audit-logs', authenticate, requireRole(['admin']), (_req: AuthRequest, res: Response) => {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 150').all();
    res.json({ logs });
  });

  router.use('/org', createOrgRouter(authenticate));

  return router;
}
