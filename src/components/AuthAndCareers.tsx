import React, { useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, Lock, Upload, ArrowRight, Globe, Shield } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import { t } from '../i18n/translations';
import type { AppLanguage, User, UserRole } from '../types/domain';
import { CandidateAssessmentPortal } from './CandidateAssessmentPortal';

const LOGO_URL = '/assets/aistudio/WhatsApp_Image_2026-11-13_at_2.17.28_PM_9e3418f5.jpeg';

interface PublicJob {
  id: string;
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
  employment_type: string;
  location: string;
  deadline: string;
  vacancies_count: number;
}

export const AuthAndCareers: React.FC<{
  lang: AppLanguage;
  onToggleLang: () => void;
  onAuthenticated: (user: User) => void;
  initialInviteToken?: string;
  initialViewMode?: 'login' | 'careers' | 'invite';
  adminPreview?: boolean;
  onExitAdminPreview?: (goToApplications?: boolean) => void;
}> = ({
  lang,
  onToggleLang,
  onAuthenticated,
  initialInviteToken,
  initialViewMode,
  adminPreview = false,
  onExitAdminPreview,
}) => {
  const [viewMode, setViewMode] = useState<'login' | 'careers' | 'invite'>(
    initialInviteToken ? 'invite' : initialViewMode || 'login'
  );
  const [inviteToken, setInviteToken] = useState(initialInviteToken || '');
  const [activeInvite, setActiveInvite] = useState(initialInviteToken || '');

  const [email, setEmail] = useState('admin@smartmasar.org');
  const [password, setPassword] = useState('Admin@2026');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [publicJobs, setPublicJobs] = useState<PublicJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<PublicJob | null>(null);

  // Application form state
  const [appName, setAppName] = useState('');
  const [appEmail, setAppEmail] = useState('');
  const [appPhone, setAppPhone] = useState('');
  const [appLocation, setAppLocation] = useState('');
  const [appSummary, setAppSummary] = useState('');
  const [appCvFile, setAppCvFile] = useState<File | null>(null);
  const [appConsent, setAppConsent] = useState(false);
  const [appSubmitting, setAppSubmitting] = useState(false);
  const [appError, setAppError] = useState('');
  const [appSuccess, setAppSuccess] = useState<{
    application_code: string;
    invite_token?: string;
    assessment_assigned: boolean;
  } | null>(null);

  useEffect(() => {
    if (viewMode === 'careers') {
      setJobsLoading(true);
      apiRequest<{ jobs: PublicJob[] }>('/api/public/jobs')
        .then((res) => setPublicJobs(res.jobs))
        .catch(() => {})
        .finally(() => setJobsLoading(false));
    }
  }, [viewMode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDemoLogin = async (role: UserRole) => {
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ demoRole: role }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJob) return;
    setAppError('');
    if (!appConsent) {
      setAppError(
        lang === 'ar'
          ? 'يرجى الموافقة على إشعار الخصوصية ومعالجة البيانات للمتابعة.'
          : 'Please accept the privacy and data consent statement.'
      );
      return;
    }

    setAppSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('job_id', selectedJob.id);
      fd.append('full_name', appName);
      fd.append('email', appEmail);
      fd.append('phone', appPhone);
      fd.append('location', appLocation);
      fd.append('cv_text_summary', appSummary);
      fd.append('consent_accepted', 'true');
      if (appCvFile) fd.append('cv', appCvFile);

      const res = await apiRequest<{
        application_code: string;
        invite_token?: string;
        assessment_assigned: boolean;
      }>('/api/public/apply', {
        method: 'POST',
        body: fd,
      });
      setAppSuccess(res);
    } catch (err) {
      setAppError((err as Error).message);
    } finally {
      setAppSubmitting(false);
    }
  };

  if (viewMode === 'invite' && activeInvite) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={LOGO_URL}
              alt="Smart Masar"
              className="h-9 w-9 rounded-lg object-cover border border-slate-200"
              referrerPolicy="no-referrer"
            />
            <span className="font-bold text-slate-900 whitespace-nowrap">
              {t(lang, 'brandName')}
            </span>
          </div>
          <button
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
          >
            <Globe className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
        </header>
        <CandidateAssessmentPortal
          inviteToken={activeInvite}
          lang={lang}
          onExit={() => {
            setActiveInvite('');
            setViewMode('careers');
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Clean 3-Zone Top Bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          <img
            src={LOGO_URL}
            alt="Smart Masar"
            className="h-9 w-9 rounded-lg object-cover border border-slate-200"
            referrerPolicy="no-referrer"
          />
          <span className="font-bold text-slate-900 text-base whitespace-nowrap">
            {lang === 'ar' ? 'مسار الذكي — Smart Masar' : 'Smart Masar — مسار الذكي'}
          </span>
        </div>

        <nav className="flex items-center gap-6 text-sm font-medium">
          {!adminPreview && (
            <button
              onClick={() => setViewMode('login')}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                viewMode === 'login'
                  ? 'text-blue-700 border-b-2 border-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t(lang, 'signIn')}
            </button>
          )}
          <button
            onClick={() => setViewMode('careers')}
            className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
              viewMode === 'careers'
                ? 'text-blue-700 border-b-2 border-blue-700'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t(lang, 'careersPortal')}
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {adminPreview && onExitAdminPreview && (
            <button
              type="button"
              onClick={() => onExitAdminPreview(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg whitespace-nowrap shrink-0"
            >
              {lang === 'ar' ? 'العودة إلى لوحة الإدارة' : 'Back to Admin Portal'}
            </button>
          )}
          <button
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
      </header>

      {/* Main Auth or Careers Content */}
      {viewMode === 'login' ? (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* Brand Panel */}
            <div className="bg-[#0B1D3A] text-white p-8 flex flex-col justify-between space-y-8">
              <div className="space-y-4">
                <img
                  src={LOGO_URL}
                  alt="Smart Masar Logo"
                  className="h-20 w-20 rounded-2xl object-cover bg-white p-1"
                  referrerPolicy="no-referrer"
                />
                <h1 className="text-2xl font-bold tracking-tight" style={{ textWrap: 'balance' }}>
                  {lang === 'ar'
                    ? 'منصة مسار الذكي للتوظيف وتقييم الكفاءات'
                    : 'Smart Masar — Intelligent Recruitment & Talent Assessment'}
                </h1>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {t(lang, 'tagline')}
                </p>
              </div>

              <div className="space-y-2.5 border-t border-white/10 pt-6 text-xs text-slate-300">
                <div className="font-semibold text-cyan-300">
                  {lang === 'ar'
                    ? 'دخول المرشح إلى الامتحان (عبر رمز أو رابط الدعوة)'
                    : 'Candidate Direct Assessment Link / Code'}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    placeholder={
                      lang === 'ar'
                        ? 'الصق رمز الدعوة (inv-...) أو الرابط الكامل'
                        : 'Paste invite code (inv-...) or full link'
                    }
                    className="flex-1 rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const raw = inviteToken.trim();
                      if (!raw) return;
                      let extracted = raw;
                      try {
                        if (raw.includes('invite=')) {
                          const parsed = new URL(
                            raw.startsWith('http') ? raw : `https://local.invalid/${raw.replace(/^\/+/, '')}`
                          );
                          extracted = parsed.searchParams.get('invite') || raw;
                        }
                      } catch {
                        extracted = raw;
                      }
                      setActiveInvite(extracted);
                      setViewMode('invite');
                    }}
                    className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium whitespace-nowrap"
                  >
                    {lang === 'ar' ? 'فتح الامتحان' : 'Open'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {lang === 'ar'
                    ? 'للمسؤول: تحصل على رابط أو رمز الدعوة من داخل النظام ← الطلبات والتصحيح ← عمود «رابط التقييم»، كما يظهر للمرشح فور تقديم طلبه.'
                    : 'Admin tip: Copy the invite link or code from Applications & Grading → Invite Link column, or after a candidate submits an application.'}
                </p>
              </div>
            </div>

            {/* Sign-In Form + Role Access */}
            <div className="p-8 space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{t(lang, 'signIn')}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {lang === 'ar'
                    ? 'نظام صلاحيات متعدد الأدوار محمي على الخادم'
                    : 'Server-enforced role-based access control'}
                </p>
              </div>

              {authError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-3">
                  {authError}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t(lang, 'email')}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t(lang, 'password')}
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  {authLoading ? t(lang, 'loading') : t(lang, 'signIn')}
                </button>
              </form>

              <div className="border-t border-slate-200 pt-5 space-y-2.5">
                <div className="text-xs font-semibold text-slate-600">
                  {t(lang, 'quickRoleAccess')}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDemoLogin('admin')}
                    className="flex items-center justify-between px-3.5 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800"
                  >
                    <span>{t(lang, 'adminRole')} · admin@smartmasar.org</span>
                    <ArrowRight className="w-3.5 h-3.5 text-blue-700" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDemoLogin('assessor')}
                    className="flex items-center justify-between px-3.5 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800"
                  >
                    <span>{t(lang, 'assessorRole')} · assessor@smartmasar.org</span>
                    <ArrowRight className="w-3.5 h-3.5 text-cyan-700" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('careers')}
                    className="flex items-center justify-between px-3.5 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800"
                  >
                    <span>{t(lang, 'careersPortal')}</span>
                    <Briefcase className="w-3.5 h-3.5 text-purple-700" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      ) : (
        /* Public Careers & Job Application Portal */
        <main className="max-w-6xl mx-auto w-full p-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {lang === 'ar' ? 'الفرص الوظيفية المتاحة' : 'Open Career Opportunities'}
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                {lang === 'ar'
                  ? 'استعرض الشواغر المنشورة وتقدّم مباشرة مع رفع السيرة الذاتية.'
                  : 'Browse published job openings and submit your application securely.'}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Shield className="w-4 h-4 text-blue-700" />
              <span>
                {lang === 'ar'
                  ? 'بيانات المتقدمين محمية ولا تُعرض للعامة'
                  : 'Applicant data is private and protected'}
              </span>
            </div>
          </div>

          {jobsLoading ? (
            <div className="p-12 text-center text-sm text-slate-500">{t(lang, 'loading')}</div>
          ) : publicJobs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
              {lang === 'ar' ? 'لا توجد شواغر منشورة حالياً.' : 'No published vacancies at this time.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Job List */}
              <div className="lg:col-span-2 space-y-4">
                {publicJobs.map((job) => (
                  <div
                    key={job.id}
                    className={`bg-white border rounded-xl p-6 space-y-4 transition-colors ${
                      selectedJob?.id === job.id ? 'border-blue-700' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-slate-500">
                          {lang === 'ar' ? job.department_ar || job.department : job.department} ·{' '}
                          {job.location} · {job.employment_type}
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 mt-1">
                          {lang === 'ar' ? job.title_ar || job.title : job.title}
                        </h2>
                      </div>
                      <div className="text-end font-mono text-xs text-slate-500 tabular-nums">
                        {lang === 'ar' ? 'الموعد النهائي:' : 'Deadline:'} {job.deadline}
                      </div>
                    </div>

                    <p className="text-sm text-slate-600 leading-relaxed">
                      {lang === 'ar' ? job.purpose_ar || job.purpose : job.purpose}
                    </p>

                    {job.qualifications.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-slate-800">
                          {lang === 'ar' ? 'المتطلبات الأساسية' : 'Key Requirements'}
                        </div>
                        <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                          {job.qualifications.slice(0, 3).map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                      <span className="text-xs text-slate-500 font-mono tabular-nums">
                        {job.vacancies_count} {lang === 'ar' ? 'شاغر' : 'vacancy(ies)'}
                      </span>
                      <button
                        onClick={() => {
                          setSelectedJob(job);
                          setAppSuccess(null);
                          setAppError('');
                        }}
                        className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium rounded-lg"
                      >
                        {t(lang, 'applyNow')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Application Submission Panel */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                {!selectedJob ? (
                  <div className="text-center py-8 space-y-2">
                    <Briefcase className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-sm text-slate-600">
                      {lang === 'ar'
                        ? 'اختر وظيفة من القائمة لتعبئة نموذج التقديم.'
                        : 'Select a job position from the list to submit your application.'}
                    </p>
                  </div>
                ) : appSuccess ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>
                        {lang === 'ar' ? 'تم استلام طلبك بنجاح!' : 'Application Submitted!'}
                      </span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs space-y-1.5 font-mono">
                      <div>
                        {lang === 'ar' ? 'رقم الطلب المرجعي:' : 'Application Reference:'}{' '}
                        <strong>{appSuccess.application_code}</strong>
                      </div>
                    </div>

                    <div className="text-xs text-slate-700 leading-relaxed bg-blue-50/70 border border-blue-200 rounded-lg p-3.5 space-y-1.5">
                      <p className="font-semibold text-blue-900">
                        {lang === 'ar'
                          ? 'الخطوة التالية: مراجعة الطلب من الإدارة'
                          : 'Next Step: HR Review'}
                      </p>
                      <p>
                        {lang === 'ar'
                          ? 'تم إرسال طلبك وسيرتك الذاتية إلى مسؤول التوظيف بنجاح. في حال ترشيحك للاختبار، سيقوم المسؤول بإرسال رابط أو رمز دعوة الامتحان الخاص بك.'
                          : 'Your application and CV have been received by the HR team. If shortlisted, the recruiter will send you your personal assessment invitation link.'}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAppSuccess(null);
                          setAppName('');
                          setAppEmail('');
                          setAppPhone('');
                          setAppLocation('');
                          setAppSummary('');
                          setAppCvFile(null);
                          setAppConsent(false);
                        }}
                        className="w-full py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg"
                      >
                        {lang === 'ar' ? 'تقديم طلب مرشح آخر' : 'Submit Another Application'}
                      </button>
                      {adminPreview && onExitAdminPreview ? (
                        <button
                          type="button"
                          onClick={() => onExitAdminPreview(true)}
                          className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg"
                        >
                          {lang === 'ar'
                            ? 'العودة لعرض المرشح والطلب في «الطلبات والتصحيح»'
                            : 'View Submitted Application in Admin → Applications'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setViewMode('login');
                          }}
                          className="w-full py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-lg"
                        >
                          {lang === 'ar' ? 'العودة إلى البوابة الرئيسية' : 'Back to Home Portal'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleApplySubmit} className="space-y-3.5">
                    <div>
                      <div className="text-xs text-slate-500">
                        {lang === 'ar' ? 'التقديم على وظيفة' : 'Applying for'}
                      </div>
                      <h3 className="text-base font-bold text-slate-900">
                        {lang === 'ar' ? selectedJob.title_ar || selectedJob.title : selectedJob.title}
                      </h3>
                    </div>

                    {appError && (
                      <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-2.5">
                        {appError}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {lang === 'ar' ? 'الاسم الكامل *' : 'Full Name *'}
                      </label>
                      <input
                        required
                        value={appName}
                        onChange={(e) => setAppName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {lang === 'ar' ? 'البريد الإلكتروني *' : 'Email *'}
                      </label>
                      <input
                        type="email"
                        required
                        value={appEmail}
                        onChange={(e) => setAppEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {lang === 'ar' ? 'رقم الهاتف' : 'Phone'}
                        </label>
                        <input
                          value={appPhone}
                          onChange={(e) => setAppPhone(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {lang === 'ar' ? 'المدينة / الموقع' : 'Location'}
                        </label>
                        <input
                          value={appLocation}
                          onChange={(e) => setAppLocation(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {lang === 'ar' ? 'السيرة الذاتية (PDF / DOCX)' : 'Upload CV (PDF / DOCX)'}
                      </label>
                      <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-lg p-2.5 text-xs text-slate-600 cursor-pointer hover:bg-slate-50">
                        <Upload className="w-4 h-4 text-blue-700" />
                        <span className="truncate">
                          {appCvFile ? appCvFile.name : lang === 'ar' ? 'اختر ملف السيرة الذاتية...' : 'Choose CV file...'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.txt"
                          onChange={(e) => setAppCvFile(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {lang === 'ar' ? 'ملخص الخبرة المهنية' : 'Experience Summary'}
                      </label>
                      <textarea
                        rows={3}
                        value={appSummary}
                        onChange={(e) => setAppSummary(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                      />
                    </div>

                    <label className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed cursor-pointer">
                      <input
                        type="checkbox"
                        checked={appConsent}
                        onChange={(e) => setAppConsent(e.target.checked)}
                        className="mt-0.5 accent-blue-700"
                      />
                      <span>{t(lang, 'privacyConsentLabel')}</span>
                    </label>

                    <button
                      type="submit"
                      disabled={appSubmitting}
                      className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg"
                    >
                      {appSubmitting
                        ? lang === 'ar'
                          ? 'جاري الإرسال...'
                          : 'Submitting...'
                        : lang === 'ar'
                          ? 'إرسال طلب التوظيف'
                          : 'Submit Application'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
};
