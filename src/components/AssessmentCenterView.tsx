import React, { useEffect, useState } from 'react';
import { Calendar, Plus, CheckCircle2, ClipboardList, Users } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AppLanguage,
  Application,
  AssessmentCenterActivity,
  AssessmentCenterConfig,
  AssessmentCenterSchedule,
  AssessorEvaluation,
  Job,
  User,
} from '../types/domain';

export const AssessmentCenterView: React.FC<{
  role: 'admin' | 'assessor';
  jobs: Job[];
  selectedJobId: string;
  onSelectJob: (id: string) => void;
  applications: Application[];
  assessors: User[];
  onRefresh: () => Promise<void>;
  lang: AppLanguage;
}> = ({ role, jobs, selectedJobId, onSelectJob, applications, assessors, onRefresh, lang }) => {
  const selectedJob = jobs.find((j) => j.id === selectedJobId) || jobs[0] || null;
  const [centerConfig, setCenterConfig] = useState<AssessmentCenterConfig | null>(null);
  const [schedules, setSchedules] = useState<AssessmentCenterSchedule[]>([]);
  const [evaluations, setEvaluations] = useState<AssessorEvaluation[]>([]);
  const [loading, setLoading] = useState(false);

  // Schedule form (Admin)
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schAppId, setSchAppId] = useState('');
  const [schActivityName, setSchActivityName] = useState('');
  const [schActivityType, setSchActivityType] = useState('Structured Interview');
  const [schMode, setSchMode] = useState<'online' | 'in_person'>('online');
  const [schDate, setSchDate] = useState('2026-11-20T10:00');
  const [schDuration, setSchDuration] = useState(45);
  const [schLocation, setSchLocation] = useState('https://meet.smartmasar.org/room-1');
  const [schAssessorId, setSchAssessorId] = useState(assessors[0]?.id || '');

  // Assessor Evaluation Form
  const [activeSchedule, setActiveSchedule] = useState<AssessmentCenterSchedule | null>(null);
  const [observations, setObservations] = useState('');
  const [evidence, setEvidence] = useState('');
  const [overallRating, setOverallRating] = useState(4);
  const [comments, setComments] = useState('');
  const [compRatings, setCompRatings] = useState<Record<string, { rating: number; score: number; comment: string }>>({});

  // Add Activity Form
  const [newActName, setNewActName] = useState('');
  const [newActType, setNewActType] = useState<AssessmentCenterActivity['type']>('Structured Interview');
  const [newActMode, setNewActMode] = useState<'online' | 'in_person'>('online');

  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const loadCenterData = async () => {
    setLoading(true);
    try {
      const schRes = await apiRequest<{
        schedules: AssessmentCenterSchedule[];
        evaluations: AssessorEvaluation[];
      }>('/api/center/schedules');
      setSchedules(schRes.schedules);
      setEvaluations(schRes.evaluations);

      if (selectedJob) {
        const cfgRes = await apiRequest<{ config: AssessmentCenterConfig }>(
          `/api/jobs/${selectedJob.id}/center-config`
        );
        setCenterConfig(cfgRes.config);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCenterData();
  }, [selectedJob?.id]);

  const notify = (text: string) => {
    setMsg(text);
    setErr('');
    setTimeout(() => setMsg(''), 3500);
  };

  const handleSaveConfig = async (updatedCfg: AssessmentCenterConfig) => {
    if (!selectedJob) return;
    try {
      await apiRequest(`/api/jobs/${selectedJob.id}/center-config`, {
        method: 'PUT',
        body: JSON.stringify(updatedCfg),
      });
      setCenterConfig(updatedCfg);
      notify(lang === 'ar' ? 'تم حفظ إعدادات مركز التقييم' : 'Assessment center configuration saved.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await apiRequest('/api/center/schedules', {
        method: 'POST',
        body: JSON.stringify({
          application_id: schAppId,
          activity_name: schActivityName || schActivityType,
          activity_type: schActivityType,
          mode: schMode,
          scheduled_at: schDate,
          duration_minutes: schDuration,
          location_or_link: schLocation,
          assessor_id: schAssessorId,
        }),
      });
      setShowScheduleForm(false);
      await loadCenterData();
      await onRefresh();
      notify(lang === 'ar' ? 'تمت جدولة نشاط مركز التقييم وتعيين المقيّم' : 'Assessment center activity scheduled.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openEvalModal = (sched: AssessmentCenterSchedule) => {
    setActiveSchedule(sched);
    setObservations('');
    setEvidence('');
    setOverallRating(4);
    setComments('');
    const job = jobs.find((j) => j.id === sched.job_id);
    const initial: Record<string, { rating: number; score: number; comment: string }> = {};
    for (const c of job?.competencies || []) {
      initial[c.id] = { rating: 4, score: 80, comment: '' };
    }
    setCompRatings(initial);
  };

  const handleSubmitEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSchedule) return;
    setErr('');
    try {
      await apiRequest('/api/center/evaluations', {
        method: 'POST',
        body: JSON.stringify({
          schedule_id: activeSchedule.id,
          observations,
          evidence,
          competency_ratings: compRatings,
          overall_rating: overallRating,
          comments,
        }),
      });
      setActiveSchedule(null);
      await loadCenterData();
      await onRefresh();
      notify(lang === 'ar' ? 'تم تسجيل تقييم المقيّم وتحديث درجات المرشح' : 'Assessor evaluation submitted and candidate score updated.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const jobApps = applications.filter((a) => !selectedJob || a.job_id === selectedJob.id);

  const journeyStages = [
    lang === 'ar' ? 'التقديم' : 'Application',
    lang === 'ar' ? 'الفرز' : 'Screening',
    lang === 'ar' ? 'الاختبار التقني' : 'Technical Test',
    lang === 'ar' ? 'الحكم الموقفي' : 'SJT',
    lang === 'ar' ? 'السلوكي' : 'Behavioral',
    lang === 'ar' ? 'المهمة العملية' : 'Practical Task',
    lang === 'ar' ? 'مركز التقييم' : 'Assessment Center',
    lang === 'ar' ? 'المراجعة النهائية' : 'Final Review',
  ];

  return (
    <div className="space-y-6">
      {role === 'admin' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-slate-600">
              {lang === 'ar' ? 'الوظيفة:' : 'Job Position:'}
            </label>
            <select
              value={selectedJob?.id || ''}
              onChange={(e) => onSelectJob(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium bg-white"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {lang === 'ar' ? j.title_ar || j.title : j.title}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => {
              setSchAppId(jobApps[0]?.id || '');
              setSchAssessorId(assessors.find((u) => u.role === 'assessor')?.id || assessors[0]?.id || '');
              setShowScheduleForm((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg"
          >
            <Plus className="w-4 h-4" />
            {lang === 'ar' ? 'جدولة جلسة مركز التقييم' : 'Schedule Assessment Activity'}
          </button>
        </div>
      )}

      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg p-3">{msg}</div>}
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg p-3">{err}</div>}

      {/* Candidate Journey Overview (Admin) */}
      {role === 'admin' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">
            {lang === 'ar' ? 'رحلة المرشح عبر مراحل التوظيف' : 'Candidate Assessment Journey'}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-xs">
            {journeyStages.map((stage, i) => (
              <div key={i} className="border border-slate-200 bg-slate-50 rounded-lg p-2.5">
                <div className="font-mono text-[10px] text-slate-400">0{i + 1}</div>
                <div className="font-medium text-slate-800 mt-0.5">{stage}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin Schedule Form */}
      {role === 'admin' && showScheduleForm && (
        <form onSubmit={handleCreateSchedule} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">
            {lang === 'ar' ? 'جدولة نشاط وتعيين مقيّم' : 'Schedule Activity & Assign Assessor'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'المرشح / الطلب *' : 'Candidate Application *'}
              </label>
              <select
                required
                value={schAppId}
                onChange={(e) => setSchAppId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
              >
                <option value="">{lang === 'ar' ? 'اختر المرشح...' : 'Select candidate...'}</option>
                {jobApps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.candidate?.full_name} ({a.application_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'نوع النشاط' : 'Activity Type'}
              </label>
              <select
                value={schActivityType}
                onChange={(e) => setSchActivityType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
              >
                <option value="Structured Interview">Structured Interview</option>
                <option value="Group Discussion">Group Discussion</option>
                <option value="Role-Play Exercise">Role-Play Exercise</option>
                <option value="Case Study">Case Study</option>
                <option value="Presentation">Presentation</option>
                <option value="In-Tray Exercise">In-Tray Exercise</option>
                <option value="Practical Work Sample">Practical Work Sample</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'اسم النشاط' : 'Activity Title'}
              </label>
              <input
                value={schActivityName}
                onChange={(e) => setSchActivityName(e.target.value)}
                placeholder="e.g. Case Study Presentation"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'المقيّم المعين *' : 'Assigned Assessor *'}
              </label>
              <select
                required
                value={schAssessorId}
                onChange={(e) => setSchAssessorId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
              >
                {assessors
                  .filter((u) => u.role === 'assessor' || u.role === 'admin')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {lang === 'ar' ? u.name_ar || u.name : u.name} ({u.role})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'النمط' : 'Delivery Mode'}
              </label>
              <select
                value={schMode}
                onChange={(e) => setSchMode(e.target.value as 'online' | 'in_person')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
              >
                <option value="online">{lang === 'ar' ? 'عن بُعد (Online)' : 'Online Meeting'}</option>
                <option value="in_person">{lang === 'ar' ? 'حضوري (In-person)' : 'In-Person'}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {lang === 'ar' ? 'التاريخ والوقت' : 'Date & Time'}
              </label>
              <input
                type="datetime-local"
                value={schDate}
                onChange={(e) => setSchDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              placeholder={lang === 'ar' ? 'رابط الاجتماع أو عنوان القاعة' : 'Meeting link or room location'}
              value={schLocation}
              onChange={(e) => setSchLocation(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="number"
              min={10}
              value={schDuration}
              onChange={(e) => setSchDuration(Number(e.target.value))}
              placeholder="Duration (minutes)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowScheduleForm(false)} className="px-4 py-2 text-xs border rounded-lg">
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" className="px-5 py-2 text-xs bg-blue-700 text-white rounded-lg font-medium">
              {lang === 'ar' ? 'حفظ الجدولة' : 'Confirm Schedule'}
            </button>
          </div>
        </form>
      )}

      {/* Assessment Center Purpose & Activities Config (Admin) */}
      {role === 'admin' && centerConfig && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              {lang === 'ar' ? 'تصميم مركز التقييم للوظيفة' : 'Assessment Center Design & Purpose'}
            </h2>
          </div>
          <textarea
            rows={2}
            value={lang === 'ar' ? centerConfig.purpose_ar || centerConfig.purpose : centerConfig.purpose}
            onChange={(e) =>
              setCenterConfig({
                ...centerConfig,
                [lang === 'ar' ? 'purpose_ar' : 'purpose']: e.target.value,
              })
            }
            className="w-full rounded-lg border border-slate-300 p-3 text-sm"
          />

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">
              {lang === 'ar' ? 'الأنشطة المعتمدة (حضوري وعن بُعد):' : 'Configured Activities (Online & In-Person):'}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {centerConfig.activities.map((act) => (
                <div key={act.id} className="border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                  <div className="font-semibold text-slate-900">
                    {lang === 'ar' ? act.name_ar || act.name : act.name}
                  </div>
                  <div className="text-slate-500 font-mono">
                    {act.type} · {act.mode} · {act.duration_minutes}m
                  </div>
                  <p className="text-slate-600">{act.description}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <input
                placeholder={lang === 'ar' ? 'اسم نشاط جديد...' : 'New activity name...'}
                value={newActName}
                onChange={(e) => setNewActName(e.target.value)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs"
              />
              <select
                value={newActType}
                onChange={(e) => setNewActType(e.target.value as AssessmentCenterActivity['type'])}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="Structured Interview">Structured Interview</option>
                <option value="Group Discussion">Group Discussion</option>
                <option value="Role-Play Exercise">Role-Play Exercise</option>
                <option value="Case Study">Case Study</option>
                <option value="Presentation">Presentation</option>
                <option value="In-Tray Exercise">In-Tray Exercise</option>
                <option value="Practical Work Sample">Practical Work Sample</option>
              </select>
              <select
                value={newActMode}
                onChange={(e) => setNewActMode(e.target.value as 'online' | 'in_person')}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="online">Online</option>
                <option value="in_person">In-Person</option>
              </select>
              <button
                onClick={() => {
                  if (!newActName.trim()) return;
                  const nextCfg: AssessmentCenterConfig = {
                    ...centerConfig,
                    activities: [
                      ...centerConfig.activities,
                      {
                        id: `act-${Date.now()}`,
                        name: newActName.trim(),
                        name_ar: newActName.trim(),
                        type: newActType,
                        mode: newActMode,
                        duration_minutes: 40,
                        competency_ids: [],
                        description: `${newActType} conducted ${newActMode}.`,
                      },
                    ],
                  };
                  setNewActName('');
                  void handleSaveConfig(nextCfg);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
              >
                + {lang === 'ar' ? 'إضافة وحفظ' : 'Add & Save Activity'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedules & Assessor Evaluation Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-700" />
            <h2 className="text-base font-bold text-slate-900">
              {role === 'assessor'
                ? lang === 'ar'
                  ? 'المرشحون والأنشطة المسندة إليّ فقط'
                  : 'My Assigned Candidates & Activities'
                : lang === 'ar'
                  ? 'جدول أنشطة مركز التقييم'
                  : 'Assessment Center Schedule'}
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-500 tabular-nums">{schedules.length} activities</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading...</div>
        ) : schedules.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {lang === 'ar' ? 'لا توجد جلسات مجدولة حالياً.' : 'No assessment center sessions scheduled yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'المرشح' : 'Candidate'}</th>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'الوظيفة والنشاط' : 'Job & Activity'}</th>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'الموعد والنمط' : 'Schedule & Mode'}</th>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'المقيّم' : 'Assessor'}</th>
                  <th className="py-3 px-4 text-start">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-3 px-4 text-end">{lang === 'ar' ? 'التقييم' : 'Evaluation'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedules.map((s) => {
                  const hasEval = evaluations.some((ev) => ev.schedule_id === s.id);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold text-slate-900">{s.candidate_name}</td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-medium text-slate-800">{s.activity_name}</div>
                        <div className="text-slate-500">{s.job_title} · {s.activity_type}</div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-600">
                        <div>{new Date(s.scheduled_at).toLocaleString()}</div>
                        <div className="text-slate-400">{s.mode} · {s.duration_minutes}m · {s.location_or_link}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">{s.assessor_name}</td>
                      <td className="py-3 px-4 text-xs font-medium text-slate-700">{s.status}</td>
                      <td className="py-3 px-4 text-end">
                        <button
                          onClick={() => openEvalModal(s)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          {hasEval
                            ? lang === 'ar'
                              ? 'تحديث التقييم'
                              : 'Add Observation'
                            : lang === 'ar'
                              ? 'تسجيل الملاحظات والتقييم'
                              : 'Evaluate Candidate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recorded Assessor Observations Summary */}
      {evaluations.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-700" />
            {lang === 'ar' ? 'سجل ملاحظات وأدلة المقيّمين' : 'Submitted Assessor Observations & Evidence'}
          </h3>
          <div className="divide-y divide-slate-100">
            {evaluations.map((ev) => (
              <div key={ev.id} className="py-3 text-xs space-y-1">
                <div className="flex justify-between font-semibold text-slate-800">
                  <span>Rating: {ev.overall_rating} / 5</span>
                  <span className="font-mono text-slate-400">{new Date(ev.submitted_at).toLocaleString()}</span>
                </div>
                <p className="text-slate-700"><strong>Observations:</strong> {ev.observations}</p>
                <p className="text-slate-600"><strong>Evidence:</strong> {ev.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assessor Evaluation Modal */}
      {activeSchedule && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitEvaluation}
            className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5"
          >
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {activeSchedule.candidate_name} — {activeSchedule.activity_name}
                </h3>
                <p className="text-xs text-slate-500">{activeSchedule.job_title}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSchedule(null)}
                className="px-3 py-1 text-xs border rounded-lg"
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {lang === 'ar' ? 'الملاحظات السلوكية والتقنية *' : 'Structured Observations *'}
                </label>
                <textarea
                  required
                  rows={3}
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {lang === 'ar' ? 'الأدلة السلوكية المسجلة *' : 'Recorded Behavioral Evidence *'}
                </label>
                <textarea
                  required
                  rows={3}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                />
              </div>
            </div>

            {/* Competency Rubric Scoring */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                {lang === 'ar' ? 'تقييم الكفاءات وفق المقياس (1–5)' : 'Competency Rubric Scoring (1–5 Scale)'}
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {(jobs.find((j) => j.id === activeSchedule.job_id)?.competencies || []).map((c) => {
                  const current = compRatings[c.id] || { rating: 4, score: 80, comment: '' };
                  return (
                    <div key={c.id} className="border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-slate-800 max-w-xs">
                        {lang === 'ar' ? c.name_ar || c.name : c.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          value={current.rating}
                          onChange={(e) => {
                            const r = Number(e.target.value);
                            setCompRatings({
                              ...compRatings,
                              [c.id]: { ...current, rating: r, score: r * 20 },
                            });
                          }}
                          className="rounded border border-slate-300 px-2 py-1 bg-white font-mono"
                        >
                          <option value={1}>1 (20%)</option>
                          <option value={2}>2 (40%)</option>
                          <option value={3}>3 (60%)</option>
                          <option value={4}>4 (80%)</option>
                          <option value={5}>5 (100%)</option>
                        </select>
                        <input
                          placeholder="Evidence note"
                          value={current.comment}
                          onChange={(e) =>
                            setCompRatings({
                              ...compRatings,
                              [c.id]: { ...current, comment: e.target.value },
                            })
                          }
                          className="rounded border border-slate-300 px-2 py-1 w-44"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {lang === 'ar' ? 'التقييم العام للجلسة (1–5)' : 'Overall Activity Rating (1–5)'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  step={0.5}
                  value={overallRating}
                  onChange={(e) => setOverallRating(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {lang === 'ar' ? 'توصيات إضافية' : 'Additional Comments'}
                </label>
                <input
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4" />
                {lang === 'ar' ? 'إرسال تقييم المقيّم' : 'Submit Assessor Evaluation'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
