import React, { useEffect, useState } from 'react';
import { Plus, Sparkles, Check, AlertTriangle, Trash2, RefreshCw } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AIJobAnalysis,
  AppLanguage,
  AssessmentWeights,
  Campaign,
  Competency,
  Job,
} from '../types/domain';

export const JobsAndAnalysisView: React.FC<{
  mode: 'jobs' | 'analysis' | 'competencies';
  jobs: Job[];
  campaigns: Campaign[];
  selectedJobId: string;
  onSelectJob: (id: string) => void;
  onRefresh: () => Promise<void>;
  lang: AppLanguage;
}> = ({ mode, jobs, campaigns, selectedJobId, onSelectJob, onRefresh, lang }) => {
  const selectedJob = jobs.find((j) => j.id === selectedJobId) || jobs[0] || null;

  // Create Job Modal/Form state
  const [showNewJob, setShowNewJob] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTitleAr, setNewTitleAr] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newCategory, setNewCategory] = useState('Finance & Accounting');
  const [newLocation, setNewLocation] = useState('Amman / Hybrid');
  const [newDeadline, setNewDeadline] = useState('2026-12-31');
  const [newVacancies, setNewVacancies] = useState(1);
  const [newPurpose, setNewPurpose] = useState('');
  const [newRawJd, setNewRawJd] = useState('');
  const [newCampaignId, setNewCampaignId] = useState(campaigns[0]?.id || '');

  // Create Campaign state
  const [showNewCamp, setShowNewCamp] = useState(false);
  const [campTitle, setCampTitle] = useState('');
  const [campTitleAr, setCampTitleAr] = useState('');

  // Weights & threshold state for selected job
  const [weights, setWeights] = useState<AssessmentWeights>(
    selectedJob?.assessment_weights || { technical: 30, sjt: 20, behavioral: 15, practical: 20, center: 15 }
  );
  const [passingThreshold, setPassingThreshold] = useState<number>(selectedJob?.passing_threshold || 70);

  // Job Analysis AI state
  const [jdInput, setJdInput] = useState(selectedJob?.raw_jd_text || '');
  const [draftAnalysis, setDraftAnalysis] = useState<AIJobAnalysis | null>(selectedJob?.ai_analysis || null);
  const [aiLoading, setAiLoading] = useState(false);

  // Competency Matrix state
  const [comps, setComps] = useState<Competency[]>(selectedJob?.competencies || []);

  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [confirmDeleteJobId, setConfirmDeleteJobId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedJob) {
      setWeights(selectedJob.assessment_weights);
      setPassingThreshold(selectedJob.passing_threshold);
      setJdInput(selectedJob.raw_jd_text || '');
      setDraftAnalysis(selectedJob.ai_analysis || null);
      setComps(selectedJob.competencies || []);
    }
  }, [selectedJob?.id, jobs]);

  const notify = (text: string) => {
    setMsg(text);
    setErr('');
    setTimeout(() => setMsg(''), 3500);
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const res = await apiRequest<{ job: Job }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          campaign_id: newCampaignId || campaigns[0]?.id,
          title: newTitle,
          title_ar: newTitleAr || newTitle,
          department: newDept,
          department_ar: newDept,
          category: newCategory,
          location: newLocation,
          deadline: newDeadline,
          vacancies_count: newVacancies,
          purpose: newPurpose,
          raw_jd_text: newRawJd,
          status: 'published',
        }),
      });
      setShowNewJob(false);
      setNewTitle('');
      setNewTitleAr('');
      setNewDept('');
      setNewPurpose('');
      setNewRawJd('');
      await onRefresh();
      onSelectJob(res.job.id);
      notify(lang === 'ar' ? 'تم إنشاء الوظيفة بنجاح' : 'Job created successfully.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          title: campTitle,
          title_ar: campTitleAr || campTitle,
          status: 'active',
          start_date: '2026-11-01',
          end_date: '2027-02-28',
        }),
      });
      setShowNewCamp(false);
      setCampTitle('');
      setCampTitleAr('');
      await onRefresh();
      notify(lang === 'ar' ? 'تم إنشاء الحملة التوظيفية' : 'Recruitment campaign created.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleStatusChange = async (jobId: string, status: Job['status']) => {
    setErr('');
    try {
      await apiRequest(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await onRefresh();
      notify(lang === 'ar' ? `تم تحديث حالة الوظيفة إلى ${status}` : `Job status updated to ${status}.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    setErr('');
    try {
      await apiRequest(`/api/jobs/${jobId}`, { method: 'DELETE' });
      setConfirmDeleteJobId(null);
      await onRefresh();
      notify(lang === 'ar' ? 'تم حذف الوظيفة وجميع بياناتها المرتبطة' : 'Job position deleted.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleSaveWeights = async () => {
    if (!selectedJob) return;
    setErr('');
    try {
      await apiRequest(`/api/jobs/${selectedJob.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assessment_weights: weights, passing_threshold: passingThreshold }),
      });
      await onRefresh();
      notify(lang === 'ar' ? 'تم حفظ أوزان التقييم وحد النجاح' : 'Assessment weights & threshold saved.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleRunAIAnalysis = async () => {
    if (!selectedJob) return;
    setAiLoading(true);
    setErr('');
    try {
      const res = await apiRequest<{ analysis: AIJobAnalysis }>('/api/ai/analyze-job', {
        method: 'POST',
        body: JSON.stringify({
          job_id: selectedJob.id,
          raw_jd_text: jdInput,
          title: selectedJob.title,
          department: selectedJob.department,
        }),
      });
      setDraftAnalysis(res.analysis);
      await onRefresh();
      notify(
        lang === 'ar'
          ? 'تم توليد تحليل الذكاء الاصطناعي للمراجعة والتعديل'
          : 'AI job analysis generated. Review and edit before approving.'
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleApproveAnalysis = async (replaceCompetencies: boolean) => {
    if (!selectedJob || !draftAnalysis) return;
    setErr('');
    try {
      await apiRequest(`/api/jobs/${selectedJob.id}/approve-analysis`, {
        method: 'POST',
        body: JSON.stringify({ analysis: draftAnalysis, replace_competencies: replaceCompetencies }),
      });
      await onRefresh();
      notify(lang === 'ar' ? 'تم اعتماد التحليل الوظيفي وتحديث ملف الوظيفة' : 'Job analysis approved.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleSaveCompetencies = async () => {
    if (!selectedJob) return;
    setErr('');
    try {
      await apiRequest(`/api/jobs/${selectedJob.id}/competencies`, {
        method: 'PUT',
        body: JSON.stringify({ competencies: comps }),
      });
      await onRefresh();
      notify(lang === 'ar' ? 'تم حفظ مصفوفة الكفاءات (المجموع 100%)' : 'Competency matrix saved (100%).');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const compWeightSum = comps.reduce((s, c) => s + Number(c.weight || 0), 0);
  const assessWeightSum =
    Number(weights.technical) +
    Number(weights.sjt) +
    Number(weights.behavioral) +
    Number(weights.practical) +
    Number(weights.center);

  return (
    <div className="space-y-6">
      {/* Shared Job Context Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">
            {lang === 'ar' ? 'الوظيفة المحددة:' : 'Active Job Position:'}
          </label>
          <select
            value={selectedJob?.id || ''}
            onChange={(e) => onSelectJob(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 bg-white"
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {lang === 'ar' ? j.title_ar || j.title : j.title} ({j.status})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewCamp((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
          >
            + {lang === 'ar' ? 'حملة جديدة' : 'New Campaign'}
          </button>
          <button
            onClick={() => setShowNewJob((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'إضافة وظيفة جديدة' : 'Create Job Position'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg p-3">{msg}</div>
      )}
      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {showNewCamp && (
        <form onSubmit={handleCreateCampaign} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">
            {lang === 'ar' ? 'إنشاء حملة توظيف جديدة' : 'New Recruitment Campaign'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              required
              placeholder={lang === 'ar' ? 'اسم الحملة بالإنجليزية' : 'Campaign Title (EN)'}
              value={campTitle}
              onChange={(e) => setCampTitle(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder={lang === 'ar' ? 'اسم الحملة بالعربية' : 'Campaign Title (AR)'}
              value={campTitleAr}
              onChange={(e) => setCampTitleAr(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowNewCamp(false)} className="px-3 py-1.5 text-xs border rounded-lg">
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" className="px-4 py-1.5 text-xs bg-slate-900 text-white rounded-lg">
              {lang === 'ar' ? 'حفظ الحملة' : 'Save Campaign'}
            </button>
          </div>
        </form>
      )}

      {showNewJob && (
        <form onSubmit={handleCreateJob} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">
            {lang === 'ar' ? 'إنشاء وظيفة شاغرة جديدة (غير مقيدة بوظيفة محددة)' : 'Create New Job Position'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'المسمى الوظيفي (EN) *' : 'Job Title (EN) *'}
              </label>
              <input
                required
                placeholder="e.g. Accountant / HR Officer / Data Analyst"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'المسمى الوظيفي (AR)' : 'Job Title (AR)'}
              </label>
              <input
                placeholder="مثال: محاسب مالي"
                value={newTitleAr}
                onChange={(e) => setNewTitleAr(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'الإدارة / القسم *' : 'Department *'}
              </label>
              <input
                required
                placeholder="e.g. Finance & Operations"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'الحملة التوظيفية' : 'Campaign'}
              </label>
              <select
                value={newCampaignId}
                onChange={(e) => setNewCampaignId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {lang === 'ar' ? c.title_ar || c.title : c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'الموقع' : 'Location'}
              </label>
              <input
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {lang === 'ar' ? 'الشواغر' : 'Vacancies'}
                </label>
                <input
                  type="number"
                  min={1}
                  value={newVacancies}
                  onChange={(e) => setNewVacancies(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {lang === 'ar' ? 'الموعد النهائي' : 'Deadline'}
                </label>
                <input
                  type="date"
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {lang === 'ar' ? 'الغرض الوظيفي' : 'Job Purpose'}
            </label>
            <input
              value={newPurpose}
              onChange={(e) => setNewPurpose(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {lang === 'ar' ? 'نص الوصف الوظيفي الكامل (للتحليل بالذكاء الاصطناعي)' : 'Full Job Description Text (for AI Analysis)'}
            </label>
            <textarea
              rows={4}
              value={newRawJd}
              onChange={(e) => setNewRawJd(e.target.value)}
              placeholder={lang === 'ar' ? 'الصق الوصف الوظيفي هنا...' : 'Paste full job description here...'}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewJob(false)}
              className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-lg"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" className="px-5 py-2 text-xs font-medium bg-blue-700 text-white rounded-lg">
              {lang === 'ar' ? 'حفظ ونشر الوظيفة' : 'Create & Publish Job'}
            </button>
          </div>
        </form>
      )}

      {/* MODE 1: JOBS & CAMPAIGNS MANAGEMENT */}
      {mode === 'jobs' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'الوظائف الشاغرة والحملات' : 'Job Positions Directory'}
              </h2>
              <span className="text-xs font-mono text-slate-500 tabular-nums">{jobs.length} jobs</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 text-start font-semibold">{lang === 'ar' ? 'الوظيفة' : 'Position'}</th>
                    <th className="py-3 px-4 text-start font-semibold">{lang === 'ar' ? 'الإدارة' : 'Department'}</th>
                    <th className="py-3 px-4 text-center font-semibold">{lang === 'ar' ? 'الشواغر' : 'Vacancies'}</th>
                    <th className="py-3 px-4 text-center font-semibold">{lang === 'ar' ? 'الكفاءات' : 'Competencies'}</th>
                    <th className="py-3 px-4 text-start font-semibold">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                    <th className="py-3 px-4 text-end font-semibold">{lang === 'ar' ? 'التحكم' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {jobs.map((j) => (
                    <tr key={j.id} className={j.id === selectedJob?.id ? 'bg-blue-50/40' : 'hover:bg-slate-50'}>
                      <td className="py-3 px-4">
                        <button onClick={() => onSelectJob(j.id)} className="text-start font-semibold text-slate-900 hover:text-blue-700">
                          {lang === 'ar' ? j.title_ar || j.title : j.title}
                        </button>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {j.location} · {j.deadline}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{lang === 'ar' ? j.department_ar || j.department : j.department}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">{j.vacancies_count}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">{j.competencies?.length || 0}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs font-semibold ${
                            j.status === 'published'
                              ? 'text-emerald-700'
                              : j.status === 'paused'
                                ? 'text-amber-700'
                                : 'text-slate-600'
                          }`}
                        >
                          {j.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end">
                        <div className="inline-flex items-center gap-1.5">
                          {j.status !== 'published' && (
                            <button
                              onClick={() => handleStatusChange(j.id, 'published')}
                              className="px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded hover:bg-emerald-100"
                            >
                              {lang === 'ar' ? 'نشر / إعادة فتح' : 'Publish / Reopen'}
                            </button>
                          )}
                          {j.status === 'published' && (
                            <button
                              onClick={() => handleStatusChange(j.id, 'paused')}
                              className="px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded hover:bg-amber-100"
                            >
                              {lang === 'ar' ? 'إيقاف مؤقت' : 'Pause'}
                            </button>
                          )}
                          {j.status !== 'closed' && (
                            <button
                              onClick={() => handleStatusChange(j.id, 'closed')}
                              className="px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                            >
                              {lang === 'ar' ? 'إغلاق' : 'Close'}
                            </button>
                          )}
                          {confirmDeleteJobId === j.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => handleDeleteJob(j.id)}
                                className="px-2 py-1 text-xs font-medium bg-rose-700 text-white rounded hover:bg-rose-800 whitespace-nowrap"
                              >
                                {lang === 'ar' ? 'تأكيد الحذف' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteJobId(null)}
                                className="px-2 py-1 text-xs font-medium border border-slate-300 text-slate-600 rounded hover:bg-slate-50"
                              >
                                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteJobId(j.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-700"
                              title={lang === 'ar' ? 'حذف الوظيفة' : 'Delete Job'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 px-4 text-center text-sm text-slate-500">
                        {lang === 'ar'
                          ? 'لا توجد وظائف حالياً. اضغط على "إضافة وظيفة جديدة" أعلاه لإنشاء وظيفتك ونشرها للتقديم.'
                          : 'No job positions yet. Click "Create Job Position" above to add and publish your first job.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedJob && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'ar' ? 'أوزان مراحل التقييم وحد النجاح للوظيفة' : 'Assessment Weights & Passing Threshold'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {lang === 'ar'
                      ? 'يجب أن يساوي مجموع أوزان أدوات التقييم 100% تماماً.'
                      : 'Assessment weights must total exactly 100%.'}
                  </p>
                </div>
                <span
                  className={`font-mono text-sm font-bold tabular-nums ${
                    assessWeightSum === 100 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {lang === 'ar' ? 'المجموع:' : 'Total:'} {assessWeightSum}%
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                {(['technical', 'sjt', 'behavioral', 'practical', 'center'] as const).map((key) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-600 mb-1 capitalize">{key} (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={weights[key]}
                      onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {lang === 'ar' ? 'حد النجاح (%)' : 'Pass Threshold (%)'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={passingThreshold}
                    onChange={(e) => setPassingThreshold(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveWeights}
                  disabled={assessWeightSum !== 100}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                >
                  {lang === 'ar' ? 'حفظ الأوزان وإعادة الاحتساب' : 'Save Weights & Recompute'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE 2: AI-ASSISTED JOB ANALYSIS */}
      {mode === 'analysis' && selectedJob && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'نص الوصف الوظيفي' : 'Job Description Input'}
              </h2>
              <span className="text-xs font-mono text-slate-500">{selectedJob.ai_analysis_status}</span>
            </div>
            <textarea
              rows={12}
              value={jdInput}
              onChange={(e) => setJdInput(e.target.value)}
              placeholder={
                lang === 'ar'
                  ? 'أدخل أو الصق الوصف الوظيفي هنا لتحليله بواسطة الذكاء الاصطناعي...'
                  : 'Paste or write the full job description text here for AI analysis...'
              }
              className="w-full rounded-lg border border-slate-300 p-3.5 text-sm leading-relaxed"
            />
            <button
              onClick={handleRunAIAnalysis}
              disabled={aiLoading || !jdInput.trim()}
              className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg inline-flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {aiLoading
                ? lang === 'ar'
                  ? 'جاري التحليل بالذكاء الاصطناعي...'
                  : 'Analyzing with Gemini AI...'
                : lang === 'ar'
                  ? 'تحليل الوصف الوظيفي بالذكاء الاصطناعي'
                  : 'Analyze Job Description with AI'}
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'مقترحات التحليل الوظيفي (قابلة للتعديل والاعتماد)' : 'Editable AI Analysis Review'}
              </h2>
            </div>

            {!draftAnalysis ? (
              <div className="py-16 text-center text-sm text-slate-500">
                {lang === 'ar'
                  ? 'شغّل التحليل بالذكاء الاصطناعي لعرض المسؤوليات والمؤهلات والكفاءات المقترحة.'
                  : 'Run AI analysis to generate editable responsibilities, qualifications, and competencies.'}
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {lang === 'ar' ? 'الغرض الوظيفي' : 'Job Purpose'}
                  </label>
                  <textarea
                    rows={3}
                    value={lang === 'ar' ? draftAnalysis.purpose_ar || draftAnalysis.purpose : draftAnalysis.purpose}
                    onChange={(e) =>
                      setDraftAnalysis({
                        ...draftAnalysis,
                        [lang === 'ar' ? 'purpose_ar' : 'purpose']: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {lang === 'ar' ? 'المسؤوليات الرئيسية (سطر لكل مسؤولية)' : 'Key Responsibilities (one per line)'}
                  </label>
                  <textarea
                    rows={4}
                    value={(draftAnalysis.responsibilities || []).join('\n')}
                    onChange={(e) =>
                      setDraftAnalysis({
                        ...draftAnalysis,
                        responsibilities: e.target.value.split('\n').filter(Boolean),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {lang === 'ar' ? 'المؤهلات المطلوبة' : 'Required Qualifications'}
                  </label>
                  <textarea
                    rows={3}
                    value={(draftAnalysis.qualifications || []).join('\n')}
                    onChange={(e) =>
                      setDraftAnalysis({
                        ...draftAnalysis,
                        qualifications: e.target.value.split('\n').filter(Boolean),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                  />
                </div>

                {(draftAnalysis.technical_competencies?.length > 0 ||
                  draftAnalysis.behavioral_competencies?.length > 0) && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-800">
                      {lang === 'ar' ? 'الكفاءات المقترحة من الذكاء الاصطناعي:' : 'AI Proposed Competencies:'}
                    </div>
                    {[...(draftAnalysis.technical_competencies || []), ...(draftAnalysis.behavioral_competencies || [])].map(
                      (c, idx) => (
                        <div key={idx} className="flex justify-between text-slate-700">
                          <span>{lang === 'ar' ? c.name_ar || c.name : c.name}</span>
                          <span className="font-mono tabular-nums">{c.weight}%</span>
                        </div>
                      )
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={() => handleApproveAnalysis(false)}
                    className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg inline-flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {lang === 'ar' ? 'اعتماد الوصف فقط' : 'Approve Profile Only'}
                  </button>
                  {(draftAnalysis.technical_competencies?.length > 0 ||
                    draftAnalysis.behavioral_competencies?.length > 0) && (
                    <button
                      onClick={() => handleApproveAnalysis(true)}
                      className="px-4 py-2 text-xs font-medium bg-blue-700 text-white rounded-lg inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {lang === 'ar'
                        ? 'اعتماد وتوليد مصفوفة الكفاءات'
                        : 'Approve & Populate Competency Matrix'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODE 3: COMPETENCY MAPPING MATRIX */}
      {mode === 'competencies' && selectedJob && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'مصفوفة الكفاءات القابلة للتعديل' : 'Editable Competency Matrix'}
              </h2>
              <p className="text-xs text-slate-500">
                {lang === 'ar'
                  ? 'كل وظيفة تمتلك مصفوفة كفاءات مستقلة. يجب أن يكون مجموع الأوزان 100%.'
                  : 'Every job has its own independent competency matrix. Total weight must equal 100%.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`px-3 py-1.5 rounded-lg font-mono text-sm font-bold tabular-nums border ${
                  Math.abs(compWeightSum - 100) < 0.01
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                {lang === 'ar' ? 'إجمالي الأوزان:' : 'Total Weight:'} {compWeightSum}%
              </div>
              <button
                onClick={() =>
                  setComps([
                    ...comps,
                    {
                      id: `new-${Date.now()}`,
                      job_id: selectedJob.id,
                      name: 'New Competency',
                      name_ar: 'كفاءة جديدة',
                      description: '',
                      description_ar: '',
                      category: 'Technical',
                      importance: 'High',
                      is_critical: false,
                      weight: Math.max(0, 100 - compWeightSum),
                      assessment_method: 'Technical Test',
                      expected_level: 'Proficient',
                      min_threshold: 60,
                      sort_order: comps.length + 1,
                    },
                  ])
                }
                className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                + {lang === 'ar' ? 'إضافة كفاءة' : 'Add Competency'}
              </button>
              <button
                onClick={handleSaveCompetencies}
                disabled={Math.abs(compWeightSum - 100) > 0.01}
                className="px-4 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg"
              >
                {lang === 'ar' ? 'حفظ المصفوفة' : 'Save Matrix'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-2 text-start">{lang === 'ar' ? 'اسم الكفاءة (EN / AR)' : 'Competency Name'}</th>
                  <th className="py-2.5 px-2 text-start">{lang === 'ar' ? 'الفئة' : 'Category'}</th>
                  <th className="py-2.5 px-2 text-start">{lang === 'ar' ? 'الأهمية' : 'Importance'}</th>
                  <th className="py-2.5 px-2 text-center">{lang === 'ar' ? 'حرجة؟' : 'Critical'}</th>
                  <th className="py-2.5 px-2 text-center">{lang === 'ar' ? 'الوزن %' : 'Weight %'}</th>
                  <th className="py-2.5 px-2 text-center">{lang === 'ar' ? 'الحد الأدنى %' : 'Min %'}</th>
                  <th className="py-2.5 px-2 text-start">{lang === 'ar' ? 'أداة التقييم' : 'Method'}</th>
                  <th className="py-2.5 px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {comps.map((c, idx) => (
                  <tr key={c.id}>
                    <td className="py-2 px-2 space-y-1 min-w-[220px]">
                      <input
                        value={c.name}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, name: e.target.value };
                          setComps(next);
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-medium"
                      />
                      <input
                        value={c.name_ar}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, name_ar: e.target.value };
                          setComps(next);
                        }}
                        placeholder="Arabic name"
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={c.category}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, category: e.target.value as 'Technical' | 'Behavioral' };
                          setComps(next);
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs bg-white"
                      >
                        <option value="Technical">Technical</option>
                        <option value="Behavioral">Behavioral</option>
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={c.importance}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, importance: e.target.value as 'Critical' | 'High' | 'Medium' };
                          setComps(next);
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs bg-white"
                      >
                        <option value="Critical">Critical</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                      </select>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={c.is_critical}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, is_critical: e.target.checked };
                          setComps(next);
                        }}
                        className="accent-blue-700"
                      />
                    </td>
                    <td className="py-2 px-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={c.weight}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, weight: Number(e.target.value) };
                          setComps(next);
                        }}
                        className="w-16 rounded border border-slate-300 px-2 py-1 text-xs text-center font-mono tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={c.min_threshold}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, min_threshold: Number(e.target.value) };
                          setComps(next);
                        }}
                        className="w-16 rounded border border-slate-300 px-2 py-1 text-xs text-center font-mono tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        value={c.assessment_method}
                        onChange={(e) => {
                          const next = [...comps];
                          next[idx] = { ...c, assessment_method: e.target.value };
                          setComps(next);
                        }}
                        className="w-36 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 px-2 text-end">
                      <button
                        onClick={() => setComps(comps.filter((_, i) => i !== idx))}
                        className="p-1.5 text-slate-400 hover:text-rose-600"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
