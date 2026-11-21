export type UserRole = 'admin' | 'assessor' | 'candidate';
export type AppLanguage = 'ar' | 'en';

export interface User {
  id: string;
  name: string;
  name_ar: string;
  email: string;
  role: UserRole;
  department: string;
  active: boolean;
  created_at: string;
}

export interface OrganizationSettings {
  id: string;
  org_name: string;
  org_name_ar: string;
  tagline: string;
  tagline_ar: string;
  logo_url: string;
  default_language: AppLanguage;
  job_categories: string[];
  competency_categories: string[];
  scoring_scale_max: number;
  passing_threshold_default: number;
  default_assessment_weights: AssessmentWeights;
  workflow_stages: string[];
  retention_days: number;
  notifications_enabled: boolean;
  updated_at: string;
}

export interface AssessmentWeights {
  technical: number;
  sjt: number;
  behavioral: number;
  practical: number;
  center: number;
}

export interface Campaign {
  id: string;
  title: string;
  title_ar: string;
  description: string;
  status: 'active' | 'planned' | 'closed';
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface AIJobAnalysis {
  purpose: string;
  purpose_ar: string;
  responsibilities: string[];
  qualifications: string[];
  experience_req: string;
  technical_competencies: Array<{
    name: string;
    name_ar: string;
    description: string;
    weight: number;
    importance: 'Critical' | 'High' | 'Medium';
    assessment_method: string;
    expected_level: string;
    min_threshold: number;
  }>;
  behavioral_competencies: Array<{
    name: string;
    name_ar: string;
    description: string;
    weight: number;
    importance: 'Critical' | 'High' | 'Medium';
    assessment_method: string;
    expected_level: string;
    min_threshold: number;
  }>;
  performance_indicators: string[];
  recommended_assessment_methods: string[];
}

export interface Job {
  id: string;
  campaign_id: string;
  title: string;
  title_ar: string;
  department: string;
  department_ar: string;
  category: string;
  purpose: string;
  purpose_ar: string;
  responsibilities: string[];
  qualifications: string[];
  experience_req: string;
  technical_skills: string[];
  behavioral_skills: string[];
  preferred_qualifications: string[];
  employment_type: 'Full-time' | 'Part-time' | 'Contract' | 'Consultancy';
  location: string;
  deadline: string;
  vacancies_count: number;
  raw_jd_text: string;
  ai_analysis: AIJobAnalysis | null;
  ai_analysis_status: 'none' | 'draft' | 'approved';
  status: 'draft' | 'published' | 'paused' | 'closed' | 'archived';
  workflow_stages: string[];
  assessment_weights: AssessmentWeights;
  passing_threshold: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  competencies?: Competency[];
}

export interface Competency {
  id: string;
  job_id: string;
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  category: 'Technical' | 'Behavioral';
  importance: 'Critical' | 'High' | 'Medium';
  is_critical: boolean;
  weight: number;
  assessment_method: string;
  expected_level: string;
  min_threshold: number;
  sort_order: number;
}

export type AssessmentSectionType = 'technical' | 'sjt' | 'behavioral' | 'practical';
export type AssessmentQuestionType =
  | 'mcq'
  | 'true_false'
  | 'short_answer'
  | 'scenario'
  | 'sjt'
  | 'likert'
  | 'practical_task';

export interface AssessmentOption {
  id: string;
  text: string;
  text_ar: string;
  score: number;
}

export interface PracticalRubricCriterion {
  criterion: string;
  criterion_ar: string;
  max_points: number;
  description: string;
}

export interface AssessmentTemplate {
  id: string;
  job_id: string;
  title: string;
  title_ar: string;
  is_reusable_template: boolean;
  approval_status: 'draft' | 'approved';
  approved_by: string | null;
  approved_at: string | null;
  duration_minutes: number;
  open_date: string;
  close_date: string;
  max_attempts: number;
  allow_resume: boolean;
  randomize_questions: boolean;
  show_results_to_candidate: boolean;
  created_at: string;
  updated_at: string;
  items?: AssessmentItem[];
}

export interface AssessmentItem {
  id: string;
  template_id: string;
  job_id: string;
  section_type: AssessmentSectionType;
  question_type: AssessmentQuestionType;
  prompt: string;
  prompt_ar: string;
  scenario_context: string;
  scenario_context_ar: string;
  options: AssessmentOption[];
  correct_answer: string;
  marking_guide: string;
  marking_guide_ar: string;
  competency_id: string;
  max_score: number;
  difficulty: 'easy' | 'medium' | 'hard';
  explanation: string;
  resources: string[];
  expected_output: string;
  rubric: PracticalRubricCriterion[];
  time_limit_minutes: number;
  approved: boolean;
  sort_order: number;
}

export interface Candidate {
  id: string;
  candidate_code: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  cv_filename: string | null;
  cv_original_name: string | null;
  cv_mime: string | null;
  cv_text_summary: string;
  consent_accepted: boolean;
  consent_at: string | null;
  is_sample_demo: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export type ApplicationStatus =
  | 'applied'
  | 'screening'
  | 'assessment_invited'
  | 'in_assessment'
  | 'assessment_center'
  | 'final_review'
  | 'shortlisted'
  | 'offered'
  | 'rejected'
  | 'archived';

export type EvaluationCategory =
  | 'pending'
  | 'meets_requirements'
  | 'further_review'
  | 'does_not_meet';

export interface Application {
  id: string;
  application_code: string;
  job_id: string;
  campaign_id: string;
  candidate_id: string;
  status: ApplicationStatus;
  current_stage: string;
  invite_token: string;
  applied_at: string;
  final_recommendation: EvaluationCategory;
  human_decision: 'pending' | 'approved_hire' | 'hold' | 'rejected';
  decision_notes: string;
  decision_by: string | null;
  decision_at: string | null;
  // Hydrated fields
  candidate?: Candidate;
  job_title?: string;
  job_title_ar?: string;
  latest_attempt?: AssessmentAttempt | null;
  attempts_count?: number;
  center_schedules?: AssessmentCenterSchedule[];
  assessor_evaluations?: AssessorEvaluation[];
  evaluation_report?: EvaluationReport | null;
}

export interface AssessmentAssignment {
  id: string;
  application_id: string;
  template_id: string;
  job_id: string;
  candidate_id: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'expired';
  attempts_allowed: number;
  due_date: string;
  assigned_by: string;
  assigned_at: string;
}

export interface CandidateAnswerRecord {
  item_id: string;
  selected_option_id?: string;
  text_response?: string;
  awarded_score?: number;
  grader_comment?: string;
}

export interface CompetencyScoreBreakdown {
  competency_id: string;
  competency_name: string;
  competency_name_ar: string;
  category: 'Technical' | 'Behavioral';
  weight: number;
  is_critical: boolean;
  min_threshold: number;
  score: number;
  weighted_contribution: number;
  meets_threshold: boolean;
  evidence_sources: string[];
}

export interface SectionScores {
  technical: number | null;
  sjt: number | null;
  behavioral: number | null;
  practical: number | null;
  center: number | null;
}

export interface AssessmentAttempt {
  id: string;
  assignment_id: string;
  application_id: string;
  template_id: string;
  job_id: string;
  candidate_id: string;
  attempt_number: number;
  status: 'in_progress' | 'submitted' | 'evaluated';
  started_at: string;
  submitted_at: string | null;
  answers: Record<string, CandidateAnswerRecord>;
  practical_submission_text: string;
  practical_attachment_name: string | null;
  section_scores: SectionScores;
  competency_scores: CompetencyScoreBreakdown[];
  overall_score: number;
  threshold_passed: boolean;
  critical_passed: boolean;
  evaluation_category: EvaluationCategory;
  strengths: string[];
  improvement_areas: string[];
  threshold_failures: string[];
  evaluator_notes: string;
  evaluated_by: string | null;
  evaluated_at: string | null;
}

export interface AssessmentCenterActivity {
  id: string;
  name: string;
  name_ar: string;
  type:
    | 'Structured Interview'
    | 'Group Discussion'
    | 'Role-Play Exercise'
    | 'Case Study'
    | 'Presentation'
    | 'In-Tray Exercise'
    | 'Practical Work Sample';
  mode: 'online' | 'in_person';
  duration_minutes: number;
  competency_ids: string[];
  description: string;
}

export interface AssessmentCenterConfig {
  id: string;
  job_id: string;
  purpose: string;
  purpose_ar: string;
  activities: AssessmentCenterActivity[];
}

export interface AssessmentCenterSchedule {
  id: string;
  job_id: string;
  application_id: string;
  candidate_id: string;
  activity_name: string;
  activity_type: string;
  mode: 'online' | 'in_person';
  scheduled_at: string;
  duration_minutes: number;
  location_or_link: string;
  assessor_id: string;
  assessor_name?: string;
  candidate_name?: string;
  job_title?: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
}

export interface AssessorEvaluation {
  id: string;
  schedule_id: string;
  application_id: string;
  job_id: string;
  candidate_id: string;
  assessor_id: string;
  assessor_name?: string;
  observations: string;
  evidence: string;
  competency_ratings: Record<string, { rating: number; score: number; comment: string }>;
  overall_rating: number;
  comments: string;
  submitted_at: string;
}

export interface EvaluationReport {
  id: string;
  application_id: string;
  job_id: string;
  candidate_id: string;
  ai_summary: string;
  strengths: string[];
  improvement_areas: string[];
  human_notes: string;
  status: 'draft' | 'approved';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export interface DashboardSummary {
  total_jobs: number;
  active_vacancies: number;
  total_applicants: number;
  under_assessment: number;
  completed_assessments: number;
  meets_requirements: number;
  further_review: number;
  does_not_meet: number;
}
