import React, { useState } from 'react';
import {
  UserPlus,
  Search,
  Send,
  FileDown,
  Archive,
  ArchiveRestore,
  RotateCcw,
  Trash2,
  ClipboardCheck,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  Copy,
  Eraser,
  Briefcase,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { apiRequest, downloadProtectedFile } from '../lib/api';
import type {
  AppLanguage,
  Application,
  AssessmentItem,
  Candidate,
  Job,
} from '../types/domain';

export const CandidatesAndAppsView: React.FC<{
  mode: 'candidates' | 'applications';
  jobs: Job[];
  candidates: Candidate[];
  applications: Application[];
  onRefresh: () => Promise<void>;
  onOpenInvitePreview: (inviteToken: string) => void;
  onOpenCareersPortal?: () => void;
  onNavigateToJobs?: () => void;
  lang: AppLanguage;
}> = ({
  mode,
  jobs,
  candidates,
  applications,
  onRefresh,
  onOpenInvitePreview,
  onOpenCareersPortal,
  onNavigateToJobs,
  lang,
}) => {
  const [search, setSearch] = useState('');
  const [filterJob, setFilterJob] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [lastArchivedId, setLastArchivedId] = useState<string | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Add Candidate form
  const [showAddCand, setShowAddCand] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [cvSummary, setCvSummary] = useState('');
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [assignJobId, setAssignJobId] = useState(jobs[0]?.id || '');

  // Assign existing candidate to job
  const [assignExistingCandId, setAssignExistingCandId] = useState('');
  const [assignExistingJobId, setAssignExistingJobId] = useState(jobs[0]?.id || '');

  // Grading & Decision Drawer
  const [gradingApp, setGradingApp] = useState<Application | null>(null);
  const [templateItems, setTemplateItems] = useState<AssessmentItem[]>([]);
  const [manualScores, setManualScores] = useState<Record<string, { awarded_score: number; grader_comment: string }>>({});
  const [evalNotes, setEvalNotes] = useState('');
  const [decisionChoice, setDecisionChoice] = useState<'pending' | 'approved_hire' | 'hold' | 'rejected'>('pending');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);

  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const notify = (text: string, duration = 3500) => {
    setMsg(text);
    setErr('');
    setTimeout(() => {
      setMsg((prev) => (prev === text ? '' : prev));
    }, duration);
  };

  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const fd = new FormData();
      fd.append('full_name', fullName);
      fd.append('email', email);
      fd.append('phone', phone);
      fd.append('location', location);
      fd.append('cv_text_summary', cvSummary);
      if (assignJobId) fd.append('job_id', assignJobId);
      if (cvFile) fd.append('cv', cvFile);

      await apiRequest('/api/candidates', { method: 'POST', body: fd });
      setShowAddCand(false);
      setFullName('');
      setEmail('');
      setPhone('');
      setLocation('');
      setCvSummary('');
      setCvFile(null);
      await onRefresh();
      notify(lang === 'ar' ? 'تمت إضافة المرشح بنجاح' : 'Candidate added successfully.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleArchiveCandidate = async (id: string, archived: boolean) => {
    try {
      await apiRequest(`/api/candidates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived }),
      });
      await onRefresh();
      if (archived) {
        setLastArchivedId(id);
        notify(
          lang === 'ar'
            ? 'تم نقل المرشح إلى الأرشيف (السجل محفوظ بالكامل ويمكن استرجاعه فوراً).'
            : 'Candidate moved to archive (all records preserved and restorable anytime).',
          8000
        );
      } else {
        setLastArchivedId(null);
        notify(
          lang === 'ar'
            ? 'تم استرجاع المرشح من الأرشيف بنجاح.'
            : 'Candidate restored from archive successfully.'
        );
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleDeleteCandidate = async (id: string) => {
    try {
      await apiRequest(`/api/candidates/${id}`, { method: 'DELETE' });
      await onRefresh();
      notify(lang === 'ar' ? 'تم حذف سجل المرشح' : 'Candidate deleted.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleClearWorkspaceData = async (scope: 'demo_only' | 'all_recruitment') => {
    setClearingData(true);
    setErr('');
    try {
      await apiRequest('/api/admin/clear-data', {
        method: 'POST',
        body: JSON.stringify({ scope }),
      });
      setShowClearModal(false);
      setLastArchivedId(null);
      await onRefresh();
      notify(
        scope === 'demo_only'
          ? lang === 'ar'
            ? 'تمت إزالة البيانات التجريبية الافتراضية بنجاح.'
            : 'Sample demo data removed.'
          : lang === 'ar'
            ? 'تم تفريغ جميع الوظائف والمرشحين والطلبات بنجاح. يمكنك الآن إنشاء وظيفتك الجديدة واستقبال الطلبات.'
            : 'All jobs, candidates, and applications cleared. Ready for your new job & applicants.'
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setClearingData(false);
    }
  };

  const handleAssignToJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignExistingCandId || !assignExistingJobId) return;
    try {
      await apiRequest('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ candidate_id: assignExistingCandId, job_id: assignExistingJobId }),
      });
      setAssignExistingCandId('');
      await onRefresh();
      notify(lang === 'ar' ? 'تم إسناد المرشح للوظيفة بملف طلب مستقل' : 'Candidate assigned to job with independent application record.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleInvite = async (appId: string) => {
    setErr('');
    try {
      const res = await apiRequest<{ invite_token: string }>(`/api/applications/${appId}/invite`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await onRefresh();
      const fullUrl = `${window.location.origin}/?invite=${res.invite_token}`;
      notify(
        lang === 'ar'
          ? `تم تفعيل دعوة التقييم! رمز الدخول: ${res.invite_token} — الرابط المباشر: ${fullUrl}`
          : `Assessment invitation activated! Code: ${res.invite_token} — Direct link: ${fullUrl}`,
        10000
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openGradingModal = async (app: Application) => {
    setGradingApp(app);
    setEvalNotes(app.latest_attempt?.evaluator_notes || '');
    setDecisionChoice(app.human_decision);
    setDecisionNotes(app.decision_notes || '');
    try {
      const res = await apiRequest<{ templates: Array<{ items?: AssessmentItem[] }> }>(
        `/api/jobs/${app.job_id}/assessments`
      );
      const items = res.templates[0]?.items || [];
      setTemplateItems(items);
      const initialScores: Record<string, { awarded_score: number; grader_comment: string }> = {};
      for (const it of items) {
        const ans = app.latest_attempt?.answers?.[it.id];
        initialScores[it.id] = {
          awarded_score: ans?.awarded_score ?? 0,
          grader_comment: ans?.grader_comment || '',
        };
      }
      setManualScores(initialScores);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleSaveGrades = async () => {
    if (!gradingApp) return;
    try {
      await apiRequest(`/api/applications/${gradingApp.id}/grade`, {
        method: 'POST',
        body: JSON.stringify({
          attempt_id: gradingApp.latest_attempt?.id,
          item_scores: manualScores,
          evaluator_notes: evalNotes,
        }),
      });
      await onRefresh();
      notify(lang === 'ar' ? 'تم حفظ الدرجات وإعادة احتساب المصفوفة' : 'Grades saved and scoring matrix recomputed.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleRecordDecision = async () => {
    if (!gradingApp) return;
    try {
      await apiRequest(`/api/applications/${gradingApp.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          human_decision: decisionChoice,
          decision_notes: decisionNotes,
        }),
      });
      await onRefresh();
      setGradingApp(null);
      notify(lang === 'ar' ? 'تم تسجيل القرار البشري النهائي' : 'Human decision recorded.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleGenerateAIDraft = async (appId: string) => {
    setAiDrafting(true);
    setErr('');
    try {
      await apiRequest(`/api/ai/evaluate-draft/${appId}`, { method: 'POST' });
      await onRefresh();
      notify(
        lang === 'ar'
          ? 'تم إنشاء مسودة التقييم المبنية على الأدلة بالذكاء الاصطناعي'
          : 'Evidence-grounded AI draft report generated.'
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiDrafting(false);
    }
  };

  const archivedCandidatesCount = candidates.filter((c) => c.archived).length;
  const archivedAppsCount = applications.filter((a) => a.candidate?.archived).length;
  const currentArchivedCount = mode === 'candidates' ? archivedCandidatesCount : archivedAppsCount;

  const filteredCandidates = candidates.filter((c) => {
    if (archiveFilter === 'active' && c.archived) return false;
    if (archiveFilter === 'archived' && !c.archived) return false;
    const q = search.toLowerCase();
    return (
      !q ||
      c.full_name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.candidate_code.toLowerCase().includes(q)
    );
  });

  const filteredApps = applications.filter((a) => {
    const isArchived = Boolean(a.candidate?.archived);
    if (archiveFilter === 'active' && isArchived) return false;
    if (archiveFilter === 'archived' && !isArchived) return false;
    if (filterJob !== 'all' && a.job_id !== filterJob) return false;
    if (filterStatus !== 'all' && a.status !== filterStatus) return false;
    const q = search.toLowerCase();
    if (q) {
      const name = a.candidate?.full_name.toLowerCase() || '';
      const code = a.application_code.toLowerCase();
      if (!name.includes(q) && !code.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'ar' ? 'بحث بالاسم أو البريد أو الرمز...' : 'Search by name, email, or ID...'}
              className="w-full rounded-lg border border-slate-300 ps-9 pe-3 py-1.5 text-sm"
            />
          </div>

          {mode === 'applications' && (
            <>
              <select
                value={filterJob}
                onChange={(e) => setFilterJob(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
              >
                <option value="all">{lang === 'ar' ? 'كل الوظائف' : 'All Jobs'}</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {lang === 'ar' ? j.title_ar || j.title : j.title}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
              >
                <option value="all">{lang === 'ar' ? 'كل الحالات' : 'All Statuses'}</option>
                <option value="applied">applied</option>
                <option value="screening">screening</option>
                <option value="assessment_invited">assessment_invited</option>
                <option value="in_assessment">in_assessment</option>
                <option value="assessment_center">assessment_center</option>
                <option value="final_review">final_review</option>
                <option value="offered">offered</option>
                <option value="rejected">rejected</option>
              </select>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setArchiveFilter('active')}
              className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 transition-colors ${
                archiveFilter === 'active'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'ar' ? 'النشطون' : 'Active'}
            </button>
            <button
              type="button"
              onClick={() => setArchiveFilter('archived')}
              className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                archiveFilter === 'archived'
                  ? 'bg-white text-amber-800 shadow-xs border border-amber-300'
                  : currentArchivedCount > 0
                    ? 'text-amber-700 hover:text-amber-900'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'ar' ? `المؤرشفون (${currentArchivedCount})` : `Archived (${currentArchivedCount})`}
            </button>
            <button
              type="button"
              onClick={() => setArchiveFilter('all')}
              className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 transition-colors ${
                archiveFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'ar' ? 'الكل' : 'All'}
            </button>
          </div>

          <button
            onClick={() => {
              if (!assignJobId && jobs[0]) setAssignJobId(jobs[0].id);
              setShowAddCand((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            {lang === 'ar' ? 'إضافة مرشح جديد' : 'Add Candidate Manually'}
          </button>

          {onOpenCareersPortal && (
            <button
              type="button"
              onClick={onOpenCareersPortal}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 rounded-lg whitespace-nowrap shrink-0"
              title={lang === 'ar' ? 'فتح صفحة التقديم العامة التي يُرسل منها المرشحون طلباتهم مباشرة لهنا' : 'Open public application portal'}
            >
              <Briefcase className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'بوابة التقديم العامة' : 'Public Apply Page'}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const applyUrl = `${window.location.origin}/?view=careers`;
              navigator.clipboard?.writeText(applyUrl);
              notify(
                lang === 'ar'
                  ? 'تم نسخ رابط التقديم العام للوظائف (أي متقدم يقدّم منه ينزل طلبه مباشرة هنا).'
                  : `Copied public careers link: ${applyUrl}`
              );
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
          >
            <Link2 className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'نسخ رابط التقديم' : 'Copy Apply Link'}
          </button>

          <button
            type="button"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await onRefresh();
                notify(lang === 'ar' ? 'تم تحديث قائمة المرشحين والطلبات.' : 'Candidates & applications refreshed.');
              } finally {
                setRefreshing(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </button>

          <button
            type="button"
            onClick={() => setShowClearModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 rounded-lg whitespace-nowrap shrink-0"
          >
            <Eraser className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'تنظيف / تفريغ القائمة' : 'Clear / Reset Data'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
          <span>{msg}</span>
          {lastArchivedId && (
            <button
              type="button"
              onClick={() => handleArchiveCandidate(lastArchivedId, false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 rounded-md whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'تراجع واسترجاع المرشح' : 'Undo & Restore'}
            </button>
          )}
        </div>
      )}
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg p-3">{err}</div>}

      {showAddCand && (
        <form onSubmit={handleAddCandidate} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">
            {lang === 'ar' ? 'تسجيل ملف مرشح جديد (بدون حد أقصى)' : 'Register New Candidate Profile'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              required
              placeholder={lang === 'ar' ? 'الاسم الكامل *' : 'Full Name *'}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="email"
              required
              placeholder={lang === 'ar' ? 'البريد الإلكتروني *' : 'Email *'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder={lang === 'ar' ? 'رقم الهاتف' : 'Phone'}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder={lang === 'ar' ? 'المدينة / الموقع' : 'Location'}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={assignJobId}
              onChange={(e) => setAssignJobId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">{lang === 'ar' ? '-- إسناد إلى وظيفة (اختياري) --' : '-- Assign to Job (Optional) --'}</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {lang === 'ar' ? j.title_ar || j.title : j.title}
                </option>
              ))}
            </select>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(e) => setCvFile(e.target.files?.[0] || null)}
              className="text-xs text-slate-600 py-1.5"
            />
          </div>
          <textarea
            rows={2}
            placeholder={lang === 'ar' ? 'ملخص السيرة الذاتية / الخبرة' : 'CV / Experience Summary'}
            value={cvSummary}
            onChange={(e) => setCvSummary(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAddCand(false)} className="px-4 py-2 text-xs border rounded-lg">
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" className="px-5 py-2 text-xs bg-blue-700 text-white rounded-lg font-medium">
              {lang === 'ar' ? 'حفظ المرشح' : 'Save Candidate'}
            </button>
          </div>
        </form>
      )}

      {/* MODE 1: CANDIDATES DIRECTORY */}
      {mode === 'candidates' && (
        <div className="space-y-4">
          <form onSubmit={handleAssignToJob} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-700">
              {lang === 'ar' ? 'ترشيح مسجل لوظيفة أخرى:' : 'Assign Existing Candidate to Job:'}
            </span>
            <select
              value={assignExistingCandId}
              onChange={(e) => setAssignExistingCandId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
            >
              <option value="">{lang === 'ar' ? 'اختر المرشح...' : 'Select candidate...'}</option>
              {candidates
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} ({c.candidate_code})
                  </option>
                ))}
            </select>
            <select
              value={assignExistingJobId}
              onChange={(e) => setAssignExistingJobId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {lang === 'ar' ? j.title_ar || j.title : j.title}
                </option>
              ))}
            </select>
            <button type="submit" className="px-3.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg">
              {lang === 'ar' ? 'إنشاء طلب مستقل' : 'Assign to Job'}
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 text-start">{lang === 'ar' ? 'المرشح' : 'Candidate'}</th>
                    <th className="py-3 px-4 text-start">{lang === 'ar' ? 'التواصل' : 'Contact'}</th>
                    <th className="py-3 px-4 text-start">{lang === 'ar' ? 'ملخص السيرة' : 'CV / Summary'}</th>
                    <th className="py-3 px-4 text-end">{lang === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCandidates.map((c) => (
                    <tr key={c.id} className={c.archived ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50'}>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{c.full_name}</div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {c.candidate_code}
                          {c.is_sample_demo && (
                            <span className="text-purple-700 font-sans font-medium">
                              {' '}
                              · {lang === 'ar' ? 'بيانات تجريبية افتراضية' : 'Sample Demo Data'}
                            </span>
                          )}
                          {c.archived && (
                            <span className="text-amber-700 font-sans font-semibold">
                              {' '}
                              · {lang === 'ar' ? 'مؤرشف' : 'Archived'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <div>{c.email}</div>
                        <div className="font-mono tabular-nums text-slate-400">
                          {c.phone} · {c.location}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 max-w-md">
                        <p className="line-clamp-2">{c.cv_text_summary || '—'}</p>
                        {c.cv_filename && (
                          <button
                            onClick={() =>
                              downloadProtectedFile(`/api/files/cv/${c.id}`, c.cv_original_name || 'cv.pdf').catch((e) =>
                                setErr((e as Error).message)
                              )
                            }
                            className="mt-1 inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            {c.cv_original_name || 'Download CV'}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-end">
                        <div className="inline-flex items-center gap-1.5">
                          {c.archived ? (
                            <button
                              onClick={() => handleArchiveCandidate(c.id, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 rounded whitespace-nowrap shrink-0"
                              title={lang === 'ar' ? 'استرجاع من الأرشيف' : 'Restore from archive'}
                            >
                              <ArchiveRestore className="w-3.5 h-3.5" />
                              {lang === 'ar' ? 'استرجاع' : 'Restore'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleArchiveCandidate(c.id, true)}
                              className="p-1.5 text-slate-500 hover:text-amber-700"
                              title={lang === 'ar' ? 'أرشفة' : 'Archive'}
                            >
                              <Archive className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteCandidate(c.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-700"
                            title={lang === 'ar' ? 'حذف' : 'Delete'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredCandidates.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 px-4 text-center text-sm text-slate-500 space-y-3">
                        <div>
                          {archiveFilter === 'archived'
                            ? lang === 'ar'
                              ? 'لا يوجد مرشحون في الأرشيف.'
                              : 'No archived candidates.'
                            : lang === 'ar'
                              ? 'القائمة فارغة حالياً. يمكنك إضافة مرشح مباشرة أو استقبال طلبات من بوابة التقديم العامة لتظهر هنا فوراً.'
                              : 'No candidates yet. Add a candidate manually or receive applications from the Public Apply Page.'}
                        </div>
                        {archiveFilter !== 'archived' && (
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            {jobs.length === 0 && onNavigateToJobs && (
                              <button
                                type="button"
                                onClick={onNavigateToJobs}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg"
                              >
                                <Briefcase className="w-3.5 h-3.5" />
                                {lang === 'ar' ? '1. إنشاء وظيفة جديدة أولاً' : '1. Create a New Job First'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowAddCand(true)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-700 text-white rounded-lg"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              {lang === 'ar' ? 'إضافة مرشح يدوياً' : 'Add Candidate Manually'}
                            </button>
                            {onOpenCareersPortal && jobs.length > 0 && (
                              <button
                                type="button"
                                onClick={onOpenCareersPortal}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-blue-200 bg-blue-50 text-blue-800 rounded-lg"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                {lang === 'ar' ? 'التقديم عبر البوابة العامة' : 'Apply via Public Portal'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: APPLICATIONS, INVITES & GRADING */}
      {mode === 'applications' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'الطلب / المرشح' : 'Application / Candidate'}</th>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'الوظيفة' : 'Applied Job'}</th>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'المرحلة والحالة' : 'Stage & Status'}</th>
                  <th className="py-3 px-4 text-center">{lang === 'ar' ? 'الدرجة' : 'Score'}</th>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'رابط التقييم' : 'Invite Link'}</th>
                  <th className="py-3 px-4 text-end">{lang === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApps.map((app) => (
                  <tr key={app.id} className={app.candidate?.archived ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50'}>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{app.candidate?.full_name}</div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums">
                        {app.application_code}
                        {app.candidate?.is_sample_demo && (
                          <span className="text-purple-700 font-sans"> · Demo</span>
                        )}
                        {app.candidate?.archived && (
                          <span className="text-amber-700 font-sans font-semibold">
                            {' '}
                            · {lang === 'ar' ? 'مؤرشف' : 'Archived'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      {lang === 'ar' ? app.job_title_ar || app.job_title : app.job_title}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-slate-800">{app.status}</div>
                      <div className="text-slate-500">
                        {app.final_recommendation} · {app.human_decision}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold tabular-nums text-slate-900">
                      {app.latest_attempt ? `${app.latest_attempt.overall_score.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {app.status === 'applied' || app.status === 'screening' ? (
                        <span className="text-slate-500">
                          {lang === 'ar'
                            ? 'طلب جديد — اضغط «دعوة» لتفعيل رابط الامتحان'
                            : 'New application — click Invite to activate exam link'}
                        </span>
                      ) : (
                        <div className="space-y-1">
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums truncate max-w-[170px]" title={app.invite_token}>
                            {app.invite_token}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              onClick={() => {
                                const fullLink = `${window.location.origin}/?invite=${app.invite_token}`;
                                navigator.clipboard?.writeText(fullLink);
                                notify(
                                  lang === 'ar'
                                    ? `تم نسخ رابط الامتحان المباشر للمرشح: ${fullLink}`
                                    : `Copied direct exam link: ${fullLink}`
                                );
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 font-medium whitespace-nowrap"
                              title={lang === 'ar' ? 'نسخ الرابط المباشر لإرساله للمرشح' : 'Copy full exam link'}
                            >
                              <Link2 className="w-3 h-3" />
                              {lang === 'ar' ? 'نسخ الرابط' : 'Copy Link'}
                            </button>
                            <button
                              onClick={() => {
                                navigator.clipboard?.writeText(app.invite_token);
                                notify(
                                  lang === 'ar'
                                    ? `تم نسخ رمز الدعوة: ${app.invite_token} (يمكن للمرشح لصقه في البوابة الأولى)`
                                    : `Copied invite code: ${app.invite_token}`
                                );
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                              title={lang === 'ar' ? 'نسخ رمز الدعوة فقط' : 'Copy invite code'}
                            >
                              <Copy className="w-3 h-3" />
                              {lang === 'ar' ? 'نسخ الرمز' : 'Copy Code'}
                            </button>
                            <button
                              onClick={() => onOpenInvitePreview(app.invite_token)}
                              className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium whitespace-nowrap"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {lang === 'ar' ? 'معاينة' : 'Open'}
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        {app.candidate?.archived && (
                          <button
                            onClick={() => handleArchiveCandidate(app.candidate!.id, false)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 rounded whitespace-nowrap shrink-0"
                          >
                            <ArchiveRestore className="w-3 h-3" />
                            {lang === 'ar' ? 'استرجاع' : 'Restore'}
                          </button>
                        )}
                        <button
                          onClick={() => handleInvite(app.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-300 rounded hover:bg-slate-100 text-slate-700 whitespace-nowrap shrink-0"
                        >
                          <Send className="w-3 h-3" />
                          {lang === 'ar' ? 'دعوة' : 'Invite'}
                        </button>
                        <button
                          onClick={() => openGradingModal(app)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <ClipboardCheck className="w-3 h-3" />
                          {lang === 'ar' ? 'تصحيح وقرار' : 'Grade & Decide'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredApps.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-sm text-slate-500 space-y-3">
                      <div>
                        {archiveFilter === 'archived'
                          ? lang === 'ar'
                            ? 'لا توجد طلبات لمرشحين مؤرشفين.'
                            : 'No applications for archived candidates.'
                          : lang === 'ar'
                            ? 'لا توجد طلبات توظيف حالياً. أي متقدم يقدّم على وظيفة منشورة (أو تتم إضافته يدوياً مع اختيار الوظيفة) سينزل طلبه مباشرة هنا.'
                            : 'No applications yet. Any applicant submitting to a published job (or added manually) appears here automatically.'}
                      </div>
                      {archiveFilter !== 'archived' && (
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {jobs.length === 0 && onNavigateToJobs && (
                            <button
                              type="button"
                              onClick={onNavigateToJobs}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg"
                            >
                              <Briefcase className="w-3.5 h-3.5" />
                              {lang === 'ar' ? '1. إنشاء ونشر وظيفة جديدة' : '1. Create & Publish a Job'}
                            </button>
                          )}
                          {onOpenCareersPortal && jobs.length > 0 && (
                            <button
                              type="button"
                              onClick={onOpenCareersPortal}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-700 text-white rounded-lg"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              {lang === 'ar' ? 'فتح صفحة التقديم لتجربة طلب جديد' : 'Open Public Apply Page'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grading, AI Summary & Human Decision Modal */}
      {gradingApp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  {gradingApp.application_code} · {gradingApp.job_title}
                </div>
                <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                  {gradingApp.candidate?.full_name} — {lang === 'ar' ? 'مراجعة التقييم والقرار البشري' : 'Grading & Human Decision'}
                </h2>
              </div>
              <button
                onClick={() => setGradingApp(null)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              >
                {lang === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>

            {!gradingApp.latest_attempt ? (
              <div className="py-6 text-center text-sm text-slate-500">
                {lang === 'ar'
                  ? 'لم يبدأ المرشح التقييم الرقمي بعد. أرسل له رابط التقييم أو افتحه من الجدول.'
                  : 'Candidate has not started or submitted the digital assessment yet.'}
              </div>
            ) : (
              <div className="space-y-5">
                {/* Score Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
                  <div>
                    <div className="text-slate-500">{lang === 'ar' ? 'الإجمالي' : 'Overall'}</div>
                    <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                      {gradingApp.latest_attempt.overall_score.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Technical</div>
                    <div className="font-bold font-mono tabular-nums">
                      {gradingApp.latest_attempt.section_scores.technical ?? '—'}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">SJT</div>
                    <div className="font-bold font-mono tabular-nums">
                      {gradingApp.latest_attempt.section_scores.sjt ?? '—'}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Behavioral</div>
                    <div className="font-bold font-mono tabular-nums">
                      {gradingApp.latest_attempt.section_scores.behavioral ?? '—'}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Practical</div>
                    <div className="font-bold font-mono tabular-nums">
                      {gradingApp.latest_attempt.section_scores.practical ?? '—'}%
                    </div>
                  </div>
                </div>

                {gradingApp.latest_attempt.threshold_failures.length > 0 && (
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800 space-y-1">
                    <div className="font-bold">
                      {lang === 'ar' ? 'تنبيه الحدود الحرجة:' : 'Threshold Warnings:'}
                    </div>
                    {gradingApp.latest_attempt.threshold_failures.map((f, i) => (
                      <div key={i}>· {f}</div>
                    ))}
                  </div>
                )}

                {/* Open-Ended & Practical Rubric Grading */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">
                    {lang === 'ar' ? 'تصحيح الإجابات المفتوحة والمهمة العملية' : 'Score Responses & Practical Work Sample'}
                  </h3>
                  {templateItems.map((it) => {
                    const ans = gradingApp.latest_attempt?.answers?.[it.id];
                    const currentScore = manualScores[it.id]?.awarded_score ?? ans?.awarded_score ?? 0;
                    return (
                      <div key={it.id} className="border border-slate-200 rounded-lg p-3.5 space-y-2 text-xs">
                        <div className="flex justify-between gap-2 font-medium text-slate-800">
                          <span>{lang === 'ar' ? it.prompt_ar || it.prompt : it.prompt}</span>
                          <span className="font-mono shrink-0">Max: {it.max_score}</span>
                        </div>
                        <div className="bg-slate-50 rounded p-2 text-slate-700">
                          <strong>{lang === 'ar' ? 'إجابة المرشح:' : 'Candidate Response:'}</strong>{' '}
                          {ans?.selected_option_id
                            ? `Option ${ans.selected_option_id}`
                            : ans?.text_response ||
                              (it.question_type === 'practical_task'
                                ? gradingApp.latest_attempt?.practical_submission_text
                                : '—')}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-1.5">
                            <span>{lang === 'ar' ? 'الدرجة:' : 'Score:'}</span>
                            <input
                              type="number"
                              min={0}
                              max={it.max_score}
                              value={currentScore}
                              onChange={(e) =>
                                setManualScores({
                                  ...manualScores,
                                  [it.id]: {
                                    awarded_score: Number(e.target.value),
                                    grader_comment: manualScores[it.id]?.grader_comment || '',
                                  },
                                })
                              }
                              className="w-20 rounded border border-slate-300 px-2 py-1 font-mono"
                            />
                          </label>
                          <input
                            placeholder={lang === 'ar' ? 'ملاحظة المقيّم...' : 'Grader note...'}
                            value={manualScores[it.id]?.grader_comment || ''}
                            onChange={(e) =>
                              setManualScores({
                                ...manualScores,
                                [it.id]: {
                                  awarded_score: currentScore,
                                  grader_comment: e.target.value,
                                },
                              })
                            }
                            className="flex-1 rounded border border-slate-300 px-2.5 py-1"
                          />
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveGrades}
                      className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg"
                    >
                      {lang === 'ar' ? 'حفظ الدرجات وإعادة الاحتساب' : 'Save Grades & Recompute Score'}
                    </button>
                  </div>
                </div>

                {/* AI Evidence-Based Evaluation Draft */}
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">
                      {lang === 'ar' ? 'ملخص التقييم المبني على الأدلة' : 'Evidence-Based Evaluation Summary'}
                    </h3>
                    <button
                      onClick={() => handleGenerateAIDraft(gradingApp.id)}
                      disabled={aiDrafting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-700 text-white rounded-lg"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {aiDrafting
                        ? lang === 'ar'
                          ? 'جاري التلخيص...'
                          : 'Drafting...'
                        : lang === 'ar'
                          ? 'توليد ملخص مسودة بالذكاء الاصطناعي'
                          : 'Draft Summary with AI'}
                    </button>
                  </div>
                  {gradingApp.evaluation_report && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-700 whitespace-pre-line">
                      {gradingApp.evaluation_report.ai_summary}
                    </div>
                  )}
                </div>

                {/* Human Final Decision (Mandatory Human Oversight) */}
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">
                    {lang === 'ar'
                      ? 'القرار البشري النهائي (لا يُتخذ تلقائياً بالذكاء الاصطناعي)'
                      : 'Human Final Decision (Never Automated)'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={decisionChoice}
                      onChange={(e) =>
                        setDecisionChoice(e.target.value as 'pending' | 'approved_hire' | 'hold' | 'rejected')
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    >
                      <option value="pending">{lang === 'ar' ? 'بانتظار القرار' : 'Pending Human Decision'}</option>
                      <option value="approved_hire">{lang === 'ar' ? 'موافقة على التعيين / العرض' : 'Approved for Hire / Offer'}</option>
                      <option value="hold">{lang === 'ar' ? 'قيد المراجعة / الاحتياط' : 'Hold / Further Review'}</option>
                      <option value="rejected">{lang === 'ar' ? 'غير مختار' : 'Not Selected'}</option>
                    </select>
                    <input
                      placeholder={lang === 'ar' ? 'مبررات القرار البشري...' : 'Human committee rationale...'}
                      value={decisionNotes}
                      onChange={(e) => setDecisionNotes(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleRecordDecision}
                      className="inline-flex items-center gap-1.5 px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium rounded-lg"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {lang === 'ar' ? 'اعتماد القرار البشري' : 'Confirm Human Decision'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Clear / Reset Data Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 space-y-5">
            <div className="space-y-1 border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'تنظيف البيانات والبدء بوظيفة ومرشحين جدد' : 'Clear Data & Start Fresh'}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {lang === 'ar'
                  ? 'اختر الطريقة المناسبة لإزالة البيانات الحالية دون التأثير على حسابات الإدارة والمقيمين أو إعدادات المنصة:'
                  : 'Choose how you want to clear existing data without affecting admin/assessor accounts or organization settings:'}
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                disabled={clearingData}
                onClick={() => handleClearWorkspaceData('demo_only')}
                className="w-full text-start p-4 rounded-xl border border-amber-200 bg-amber-50/50 hover:bg-amber-50 space-y-1 transition-colors disabled:opacity-50"
              >
                <div className="text-sm font-bold text-amber-900">
                  {lang === 'ar'
                    ? '1. إزالة البيانات التجريبية الافتراضية فقط'
                    : '1. Remove Sample Demo Data Only'}
                </div>
                <div className="text-xs text-amber-800">
                  {lang === 'ar'
                    ? 'يحذف المرشحين التجريبيين الثلاثة والوظيفة الافتراضية فقط، ويبقي أي وظائف أو مرشحين أضفتهم أنت.'
                    : 'Removes the 3 preloaded sample candidates and default MEAL demo job while keeping your custom jobs & candidates.'}
                </div>
              </button>

              <button
                type="button"
                disabled={clearingData}
                onClick={() => handleClearWorkspaceData('all_recruitment')}
                className="w-full text-start p-4 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-50 space-y-1 transition-colors disabled:opacity-50"
              >
                <div className="text-sm font-bold text-rose-900">
                  {lang === 'ar'
                    ? '2. تفريغ كل الوظائف والمرشحين والطلبات والبدء من الصفر'
                    : '2. Clear All Jobs, Candidates & Applications (Clean Slate)'}
                </div>
                <div className="text-xs text-rose-800">
                  {lang === 'ar'
                    ? 'يمسح جميع الوظائف والمرشحين والطلبات والتقييمات لتبدأ فوراً بإنشاء وظيفتك الجديدة واستقبال المرشحين الحقيقيين.'
                    : 'Clears all jobs, candidates, applications, and assessments so you can immediately create your own job and receive real applicants.'}
                </div>
              </button>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={clearingData}
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                {lang === 'ar' ? 'إغلاق / إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
