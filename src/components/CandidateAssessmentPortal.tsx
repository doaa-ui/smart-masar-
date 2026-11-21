import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileCheck2, AlertCircle, Send, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AppLanguage,
  AssessmentAttempt,
  AssessmentItem,
  CandidateAnswerRecord,
} from '../types/domain';

interface InvitePayload {
  application: {
    id: string;
    application_code: string;
    status: string;
    current_stage: string;
    applied_at: string;
  };
  candidate: {
    id: string;
    candidate_code: string;
    full_name: string;
    email: string;
  };
  job: {
    id: string;
    title: string;
    title_ar: string;
    department: string;
    purpose: string;
    purpose_ar: string;
  };
  template: {
    id: string;
    title: string;
    title_ar: string;
    duration_minutes: number;
    open_date: string;
    close_date: string;
    max_attempts: number;
    allow_resume: boolean;
    randomize_questions: boolean;
    show_results_to_candidate: boolean;
  } | null;
  items: AssessmentItem[];
  attempts: AssessmentAttempt[];
}

export const CandidateAssessmentPortal: React.FC<{
  inviteToken: string;
  lang: AppLanguage;
  onExit?: () => void;
}> = ({ inviteToken, lang, onExit }) => {
  const [data, setData] = useState<InvitePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeAttempt, setActiveAttempt] = useState<AssessmentAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, CandidateAnswerRecord>>({});
  const [practicalText, setPracticalText] = useState('');
  const [activeSection, setActiveSection] = useState<'technical' | 'sjt' | 'behavioral' | 'practical'>('technical');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadInvite = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<InvitePayload>(`/api/candidate/invite/${inviteToken}`);
      setData(res);
      const inProg = res.attempts.find((a) => a.status === 'in_progress');
      if (inProg) {
        setActiveAttempt(inProg);
        setAnswers(inProg.answers || {});
        setPracticalText(inProg.practical_submission_text || '');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvite();
  }, [inviteToken]);

  useEffect(() => {
    if (!activeAttempt || !data?.template?.duration_minutes) return;
    const startMs = new Date(activeAttempt.started_at).getTime();
    const totalSec = data.template.duration_minutes * 60;
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setSecondsLeft(Math.max(0, totalSec - elapsed));
    };
    updateTimer();
    const id = setInterval(updateTimer, 1000);
    return () => clearInterval(id);
  }, [activeAttempt?.id, data?.template?.duration_minutes]);

  const handleStart = async () => {
    setError('');
    try {
      const res = await apiRequest<{ attempt: AssessmentAttempt }>(
        `/api/candidate/invite/${inviteToken}/start`,
        { method: 'POST' }
      );
      setActiveAttempt(res.attempt);
      setAnswers(res.attempt.answers || {});
      setPracticalText(res.attempt.practical_submission_text || '');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSave = async (nextAnswers?: Record<string, CandidateAnswerRecord>, nextPractical?: string) => {
    if (!activeAttempt) return;
    try {
      await apiRequest(`/api/candidate/invite/${inviteToken}/save`, {
        method: 'PUT',
        body: JSON.stringify({
          attempt_id: activeAttempt.id,
          answers: nextAnswers ?? answers,
          practical_submission_text: nextPractical ?? practicalText,
        }),
      });
      setSaveMessage(lang === 'ar' ? 'تم الحفظ التلقائي' : 'Progress saved');
      setTimeout(() => setSaveMessage(''), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleAnswerChange = (itemId: string, patch: Partial<CandidateAnswerRecord>) => {
    const next = {
      ...answers,
      [itemId]: {
        ...(answers[itemId] || { item_id: itemId }),
        ...patch,
      },
    };
    setAnswers(next);
    void handleSave(next, practicalText);
  };

  const handleSubmit = async () => {
    if (!activeAttempt) return;
    setSubmitting(true);
    setError('');
    try {
      await apiRequest(`/api/candidate/invite/${inviteToken}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          attempt_id: activeAttempt.id,
          answers,
          practical_submission_text: practicalText,
        }),
      });
      setActiveAttempt(null);
      await loadInvite();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-slate-600">
        {lang === 'ar' ? 'جاري تحميل بوابة التقييم...' : 'Loading assessment portal...'}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white border border-rose-200 rounded-xl p-6 text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <p className="text-sm text-rose-700">{error}</p>
        {onExit && (
          <button onClick={onExit} className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg">
            {lang === 'ar' ? 'العودة' : 'Back'}
          </button>
        )}
      </div>
    );
  }

  if (!data) return null;

  const sections: Array<{ key: 'technical' | 'sjt' | 'behavioral' | 'practical'; label: string }> = [
    { key: 'technical', label: lang === 'ar' ? '1. الاختبار التقني' : '1. Technical Test' },
    { key: 'sjt', label: lang === 'ar' ? '2. الحكم الموقفي (SJT)' : '2. Situational Judgment' },
    { key: 'behavioral', label: lang === 'ar' ? '3. التقييم السلوكي' : '3. Behavioral' },
    { key: 'practical', label: lang === 'ar' ? '4. المهمة العملية' : '4. Practical Work Sample' },
  ];

  const sectionItems = data.items.filter((it) => it.section_type === activeSection);
  const totalItems = data.items.length;
  const answeredCount = data.items.filter((it) => {
    const a = answers[it.id];
    if (it.question_type === 'practical_task') {
      return (a?.text_response || practicalText || '').trim().length > 0;
    }
    return Boolean(a?.selected_option_id || (a?.text_response && a.text_response.trim().length > 0));
  }).length;

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {data.application.application_code} · {data.candidate.full_name}
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">
            {lang === 'ar' ? data.job.title_ar || data.job.title : data.job.title}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            {data.template
              ? lang === 'ar'
                ? data.template.title_ar || data.template.title
                : data.template.title
              : lang === 'ar'
                ? 'لا يوجد نموذج تقييم مسند بعد'
                : 'No assessment template assigned yet'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {activeAttempt && secondsLeft !== null && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-mono text-sm tabular-nums">
              <Clock className="w-4 h-4 text-cyan-400" />
              {formatTimer(secondsLeft)}
            </div>
          )}
          {saveMessage && <span className="text-xs font-medium text-emerald-700">{saveMessage}</span>}
          {onExit && (
            <button
              onClick={onExit}
              className="px-3.5 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
            >
              {lang === 'ar' ? 'إغلاق البوابة' : 'Exit Portal'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg p-3">{error}</div>
      )}

      {/* Pre-start instructions or Completed Attempts Summary */}
      {!activeAttempt && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">
              {lang === 'ar' ? 'تعليمات التقييم الرقمي' : 'Assessment Instructions'}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {lang === 'ar'
                ? 'يتكون هذا التقييم من أربعة أجزاء مرتبطة مباشرة بمصفوفة كفاءات الوظيفة: الاختبار المعرفي والتقني، اختبار الحكم الموقفي، التقييم السلوكي المهني (غير التشخيصي)، والمهمة التطبيقية العملية. يتم حفظ إجاباتك تلقائياً أثناء العمل.'
                : 'This assessment consists of four competency-mapped sections: Technical Knowledge Test, Situational Judgment Test (SJT), Non-Diagnostic Workplace Behavioral Assessment, and a Practical Work Sample. Your answers are saved reliably as you progress.'}
            </p>
          </div>

          {data.template && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-b border-slate-100 py-4 text-sm">
              <div>
                <div className="text-xs text-slate-500">{lang === 'ar' ? 'المدة الزمنية' : 'Duration'}</div>
                <div className="font-semibold text-slate-900 font-mono tabular-nums">
                  {data.template.duration_minutes} {lang === 'ar' ? 'دقيقة' : 'min'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{lang === 'ar' ? 'عدد الفقرات' : 'Total Items'}</div>
                <div className="font-semibold text-slate-900 font-mono tabular-nums">{totalItems}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{lang === 'ar' ? 'المحاولات المسموحة' : 'Attempts Allowed'}</div>
                <div className="font-semibold text-slate-900 font-mono tabular-nums">
                  {data.attempts.length} / {data.template.max_attempts}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{lang === 'ar' ? 'حالة الطلب' : 'Status'}</div>
                <div className="font-semibold text-blue-700">{data.application.status}</div>
              </div>
            </div>
          )}

          {data.template && data.attempts.length < data.template.max_attempts && (
            <button
              onClick={handleStart}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <FileCheck2 className="w-4 h-4" />
              {data.attempts.length === 0
                ? lang === 'ar'
                  ? 'بدء التقييم الآن'
                  : 'Start Assessment'
                : lang === 'ar'
                  ? 'بدء محاولة جديدة'
                  : 'Start New Attempt'}
            </button>
          )}

          {data.attempts.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {lang === 'ar' ? 'سجل المحاولات السابقة' : 'Recorded Assessment Attempts'}
              </h3>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {data.attempts.map((att) => (
                  <div key={att.id} className="p-4 flex flex-wrap items-center justify-between gap-4 text-sm">
                    <div className="space-y-0.5">
                      <div className="font-medium text-slate-900 font-mono tabular-nums">
                        {lang === 'ar' ? `المحاولة #${att.attempt_number}` : `Attempt #${att.attempt_number}`} · {att.status}
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums">
                        {att.submitted_at ? `${lang === 'ar' ? 'تاريخ الإرسال:' : 'Submitted:'} ${new Date(att.submitted_at).toLocaleString()}` : 'In progress'}
                      </div>
                    </div>
                    {data.template?.show_results_to_candidate && att.status !== 'in_progress' ? (
                      <div className="text-end">
                        <div className="font-mono font-bold text-slate-900 tabular-nums">
                          {att.overall_score.toFixed(1)} / 100
                        </div>
                        <div className="text-xs text-slate-600">{att.evaluation_category}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        {lang === 'ar' ? 'تم استلام الإجابات بنجاح' : 'Submission recorded'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Assessment Delivery Interface */}
      {activeAttempt && (
        <div className="space-y-6">
          {/* Progress & Section Navigation */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {lang === 'ar' ? 'تقدم الإنجاز' : 'Assessment Progress'}:{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {answeredCount} / {totalItems}
                </strong>
              </span>
              <span className="font-mono tabular-nums">
                {totalItems > 0 ? Math.round((answeredCount / totalItems) * 100) : 0}%
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-700 transition-all duration-200"
                style={{ width: `${totalItems > 0 ? (answeredCount / totalItems) * 100 : 0}%` }}
              />
            </div>

            <div className="flex flex-wrap gap-1.5 pt-2">
              {sections.map((sec) => (
                <button
                  key={sec.key}
                  onClick={() => setActiveSection(sec.key)}
                  className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    activeSection === sec.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {sec.label}
                </button>
              ))}
            </div>
          </div>

          {/* Section Questions */}
          <div className="space-y-4">
            {sectionItems.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                {lang === 'ar' ? 'لا توجد فقرات في هذا القسم.' : 'No items configured in this section.'}
              </div>
            ) : (
              sectionItems.map((item, idx) => {
                const currentAns = answers[item.id] || { item_id: item.id };
                return (
                  <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono tabular-nums">
                        {lang === 'ar' ? `السؤال ${idx + 1}` : `Item ${idx + 1}`} · {item.question_type}
                      </span>
                      <span className="font-mono tabular-nums">
                        {item.max_score} {lang === 'ar' ? 'نقطة' : 'pts'}
                      </span>
                    </div>

                    {(item.scenario_context || item.scenario_context_ar) && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-sm text-slate-700 leading-relaxed">
                        {lang === 'ar' ? item.scenario_context_ar || item.scenario_context : item.scenario_context}
                      </div>
                    )}

                    <h3 className="text-base font-semibold text-slate-900 leading-snug">
                      {lang === 'ar' ? item.prompt_ar || item.prompt : item.prompt}
                    </h3>

                    {item.resources && item.resources.length > 0 && (
                      <div className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono space-y-1 overflow-x-auto">
                        {item.resources.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}

                    {/* Options for MCQ / TrueFalse / SJT / Likert */}
                    {item.options && item.options.length > 0 && (
                      <div className="space-y-2">
                        {item.options.map((opt) => {
                          const selected = currentAns.selected_option_id === opt.id;
                          return (
                            <label
                              key={opt.id}
                              className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                                selected
                                  ? 'border-blue-700 bg-blue-50/60 text-slate-900'
                                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`item-${item.id}`}
                                checked={selected}
                                onChange={() => handleAnswerChange(item.id, { selected_option_id: opt.id })}
                                className="mt-1 accent-blue-700"
                              />
                              <span className="text-sm leading-relaxed">
                                {lang === 'ar' ? opt.text_ar || opt.text : opt.text}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Short Answer / Practical Task text response */}
                    {(item.question_type === 'short_answer' ||
                      item.question_type === 'practical_task' ||
                      item.options.length === 0) && (
                      <div className="space-y-2">
                        <textarea
                          rows={item.question_type === 'practical_task' ? 8 : 4}
                          value={
                            item.question_type === 'practical_task'
                              ? currentAns.text_response ?? practicalText
                              : currentAns.text_response ?? ''
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (item.question_type === 'practical_task') {
                              setPracticalText(val);
                            }
                            handleAnswerChange(item.id, { text_response: val });
                          }}
                          placeholder={
                            lang === 'ar'
                              ? 'اكتب إجابتك التحليلية أو مخرجات المهمة العملية هنا...'
                              : 'Enter your structured answer or practical work sample output here...'
                          }
                          className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Submit Footer */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-slate-600">
              {lang === 'ar'
                ? 'تأكد من مراجعة جميع الأقسام الأربعة قبل الإرسال النهائي.'
                : 'Review all four assessment sections before final submission.'}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleSave()}
                className="px-4 py-2 text-sm font-medium border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
              >
                {lang === 'ar' ? 'حفظ المسودة' : 'Save Draft'}
              </button>
              <button
                disabled={submitting}
                onClick={handleSubmit}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg"
              >
                <Send className="w-4 h-4" />
                {submitting
                  ? lang === 'ar'
                    ? 'جاري الإرسال...'
                    : 'Submitting...'
                  : lang === 'ar'
                    ? 'إرسال التقييم نهائياً'
                    : 'Submit Assessment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
