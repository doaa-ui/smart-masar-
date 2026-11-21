import React, { useEffect, useState } from 'react';
import { Sparkles, Plus, CheckCircle2, Trash2, AlertTriangle, Save } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AppLanguage,
  AssessmentItem,
  AssessmentOption,
  AssessmentQuestionType,
  AssessmentSectionType,
  AssessmentTemplate,
  Job,
} from '../types/domain';

export const AssessmentToolsView: React.FC<{
  jobs: Job[];
  selectedJobId: string;
  onSelectJob: (id: string) => void;
  lang: AppLanguage;
}> = ({ jobs, selectedJobId, onSelectJob, lang }) => {
  const selectedJob = jobs.find((j) => j.id === selectedJobId) || jobs[0] || null;
  const [templates, setTemplates] = useState<AssessmentTemplate[]>([]);
  const [activeSection, setActiveSection] = useState<AssessmentSectionType>('technical');
  const [loading, setLoading] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Manual new item form
  const [showAddItem, setShowAddItem] = useState(false);
  const [newPrompt, setNewPrompt] = useState('');
  const [newPromptAr, setNewPromptAr] = useState('');
  const [newQType, setNewQType] = useState<AssessmentQuestionType>('mcq');
  const [newCompId, setNewCompId] = useState('');
  const [newMaxScore, setNewMaxScore] = useState(10);
  const [newGuide, setNewGuide] = useState('');
  const [newOptA, setNewOptA] = useState('');
  const [newOptB, setNewOptB] = useState('');
  const [newOptC, setNewOptC] = useState('');
  const [newOptD, setNewOptD] = useState('');
  const [newCorrect, setNewCorrect] = useState('a');

  const loadAssessments = async () => {
    if (!selectedJob) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ templates: AssessmentTemplate[] }>(
        `/api/jobs/${selectedJob.id}/assessments`
      );
      setTemplates(res.templates);
      if (selectedJob.competencies?.[0]) {
        setNewCompId(selectedJob.competencies[0].id);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssessments();
  }, [selectedJob?.id]);

  const activeTemplate = templates[0] || null;

  const notify = (text: string) => {
    setMsg(text);
    setErr('');
    setTimeout(() => setMsg(''), 3500);
  };

  const handleGenerateWithAI = async () => {
    if (!selectedJob || !activeTemplate) return;
    setAiGenerating(true);
    setErr('');
    try {
      const res = await apiRequest<{ generated_count: number }>(
        `/api/jobs/${selectedJob.id}/assessments/generate`,
        {
          method: 'POST',
          body: JSON.stringify({
            template_id: activeTemplate.id,
            section_type: activeSection,
            count: activeSection === 'practical' ? 1 : 3,
          }),
        }
      );
      await loadAssessments();
      notify(
        lang === 'ar'
          ? `تم توليد ${res.generated_count} فقرات مسودة بواسطة الذكاء الاصطناعي. راجعها واعتمدها قبل النشر.`
          : `Generated ${res.generated_count} draft items with AI. Review and approve items before candidate assignment.`
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleToggleItemApprove = async (item: AssessmentItem) => {
    try {
      await apiRequest(`/api/assessment-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ approved: !item.approved }),
      });
      await loadAssessments();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await apiRequest(`/api/assessment-items/${id}`, { method: 'DELETE' });
      await loadAssessments();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleUpdateTemplateConfig = async (patch: Partial<AssessmentTemplate>) => {
    if (!activeTemplate) return;
    setErr('');
    try {
      await apiRequest(`/api/assessment-templates/${activeTemplate.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await loadAssessments();
      notify(lang === 'ar' ? 'تم تحديث إعدادات نموذج التقييم' : 'Assessment template updated.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleAddManualItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJob || !activeTemplate) return;

    let options: AssessmentOption[] = [];
    if (newQType === 'mcq' || newQType === 'sjt') {
      options = [
        { id: 'a', text: newOptA || 'Option A', text_ar: newOptA || 'الخيار أ', score: newCorrect === 'a' ? newMaxScore : 0 },
        { id: 'b', text: newOptB || 'Option B', text_ar: newOptB || 'الخيار ب', score: newCorrect === 'b' ? newMaxScore : 0 },
        { id: 'c', text: newOptC || 'Option C', text_ar: newOptC || 'الخيار ج', score: newCorrect === 'c' ? newMaxScore : 0 },
        { id: 'd', text: newOptD || 'Option D', text_ar: newOptD || 'الخيار د', score: newCorrect === 'd' ? newMaxScore : 0 },
      ];
    } else if (newQType === 'true_false') {
      options = [
        { id: 'true', text: 'True', text_ar: 'صح', score: newCorrect === 'true' ? newMaxScore : 0 },
        { id: 'false', text: 'False', text_ar: 'خطأ', score: newCorrect === 'false' ? newMaxScore : 0 },
      ];
    } else if (newQType === 'likert') {
      options = [1, 2, 3, 4, 5].map((n) => ({
        id: String(n),
        text: `${n} / 5`,
        text_ar: `${n} / 5`,
        score: n,
      }));
    }

    try {
      await apiRequest(`/api/jobs/${selectedJob.id}/assessments/items`, {
        method: 'POST',
        body: JSON.stringify({
          template_id: activeTemplate.id,
          section_type: activeSection,
          question_type: newQType,
          prompt: newPrompt,
          prompt_ar: newPromptAr || newPrompt,
          options,
          correct_answer: newCorrect,
          marking_guide: newGuide,
          competency_id: newCompId || selectedJob.competencies?.[0]?.id || '',
          max_score: newMaxScore,
          approved: true,
        }),
      });
      setShowAddItem(false);
      setNewPrompt('');
      setNewPromptAr('');
      setNewGuide('');
      await loadAssessments();
      notify(lang === 'ar' ? 'تمت إضافة الفقرة التقييمية' : 'Assessment item added.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const sectionTabs: Array<{ key: AssessmentSectionType; label: string }> = [
    { key: 'technical', label: lang === 'ar' ? '1. الاختبار التقني' : '1. Technical Test' },
    { key: 'sjt', label: lang === 'ar' ? '2. الحكم الموقفي (SJT)' : '2. Situational Judgment (SJT)' },
    { key: 'behavioral', label: lang === 'ar' ? '3. التقييم السلوكي (غير تشخيصي)' : '3. Workplace Behavioral' },
    { key: 'practical', label: lang === 'ar' ? '4. المهمة التطبيقية العملية' : '4. Practical Work Sample' },
  ];

  const itemsInSection = (activeTemplate?.items || []).filter((i) => i.section_type === activeSection);

  return (
    <div className="space-y-6">
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

        {activeTemplate && (
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-semibold ${
                activeTemplate.approval_status === 'approved' ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {activeTemplate.approval_status === 'approved'
                ? lang === 'ar'
                  ? 'نموذج تقييم معتمد'
                  : 'Template Approved'
                : lang === 'ar'
                  ? 'مسودة بانتظار الاعتماد'
                  : 'Draft Pending Approval'}
            </span>
            {activeTemplate.approval_status !== 'approved' && (
              <button
                onClick={() => handleUpdateTemplateConfig({ approval_status: 'approved' })}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'اعتماد نموذج التقييم للمرشحين' : 'Approve Template for Delivery'}
              </button>
            )}
          </div>
        )}
      </div>

      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg p-3">{msg}</div>}
      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {/* Template Delivery Configuration */}
      {activeTemplate && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 sm:grid-cols-6 gap-4 items-end text-xs">
          <div>
            <label className="block font-medium text-slate-600 mb-1">
              {lang === 'ar' ? 'المدة (دقيقة)' : 'Duration (min)'}
            </label>
            <input
              type="number"
              value={activeTemplate.duration_minutes}
              onChange={(e) =>
                setTemplates([{ ...activeTemplate, duration_minutes: Number(e.target.value) }])
              }
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600 mb-1">
              {lang === 'ar' ? 'المحاولات القصوى' : 'Max Attempts'}
            </label>
            <input
              type="number"
              min={1}
              value={activeTemplate.max_attempts}
              onChange={(e) =>
                setTemplates([{ ...activeTemplate, max_attempts: Number(e.target.value) }])
              }
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
            />
          </div>
          <label className="flex items-center gap-2 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={activeTemplate.allow_resume}
              onChange={(e) => setTemplates([{ ...activeTemplate, allow_resume: e.target.checked }])}
              className="accent-blue-700"
            />
            <span>{lang === 'ar' ? 'السماح بالاستئناف' : 'Allow Resume'}</span>
          </label>
          <label className="flex items-center gap-2 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={activeTemplate.randomize_questions}
              onChange={(e) =>
                setTemplates([{ ...activeTemplate, randomize_questions: e.target.checked }])
              }
              className="accent-blue-700"
            />
            <span>{lang === 'ar' ? 'ترتيب عشوائي' : 'Randomize'}</span>
          </label>
          <label className="flex items-center gap-2 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={activeTemplate.show_results_to_candidate}
              onChange={(e) =>
                setTemplates([{ ...activeTemplate, show_results_to_candidate: e.target.checked }])
              }
              className="accent-blue-700"
            />
            <span>{lang === 'ar' ? 'إظهار النتيجة للمرشح' : 'Show Results'}</span>
          </label>
          <button
            onClick={() =>
              handleUpdateTemplateConfig({
                duration_minutes: activeTemplate.duration_minutes,
                max_attempts: activeTemplate.max_attempts,
                allow_resume: activeTemplate.allow_resume,
                randomize_questions: activeTemplate.randomize_questions,
                show_results_to_candidate: activeTemplate.show_results_to_candidate,
              })
            }
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-lg font-medium"
          >
            <Save className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'حفظ الإعدادات' : 'Save Config'}
          </button>
        </div>
      )}

      {/* 4 Assessment Type Tabs + AI Generate + Manual Add */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {sectionTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveSection(tab.key)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors ${
                  activeSection === tab.key
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerateWithAI}
              disabled={aiGenerating}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-purple-700 hover:bg-purple-800 disabled:opacity-60 text-white rounded-lg"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {aiGenerating
                ? lang === 'ar'
                  ? 'جاري التوليد...'
                  : 'Generating...'
                : lang === 'ar'
                  ? 'توليد أسئلة بالذكاء الاصطناعي'
                  : 'Generate Drafts with AI'}
            </button>
            <button
              onClick={() => {
                setNewQType(
                  activeSection === 'sjt'
                    ? 'sjt'
                    : activeSection === 'behavioral'
                      ? 'likert'
                      : activeSection === 'practical'
                        ? 'practical_task'
                        : 'mcq'
                );
                setShowAddItem((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-800"
            >
              <Plus className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'إضافة فقرة يدوياً' : 'Add Manual Item'}
            </button>
          </div>
        </div>

        {showAddItem && (
          <form onSubmit={handleAddManualItem} className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Question Type</label>
                <select
                  value={newQType}
                  onChange={(e) => setNewQType(e.target.value as AssessmentQuestionType)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                >
                  <option value="mcq">Multiple Choice</option>
                  <option value="true_false">True / False</option>
                  <option value="short_answer">Short Answer</option>
                  <option value="sjt">Situational Judgment (SJT)</option>
                  <option value="likert">Likert Behavioral</option>
                  <option value="practical_task">Practical Work Sample</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Competency Measured</label>
                <select
                  value={newCompId}
                  onChange={(e) => setNewCompId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                >
                  {(selectedJob?.competencies || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {lang === 'ar' ? c.name_ar || c.name : c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Max Score</label>
                <input
                  type="number"
                  min={1}
                  value={newMaxScore}
                  onChange={(e) => setNewMaxScore(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <textarea
                required
                rows={3}
                placeholder="Question prompt (English)"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                className="rounded-lg border border-slate-300 p-2.5 text-sm bg-white"
              />
              <textarea
                rows={3}
                placeholder="نص السؤال بالعربية"
                value={newPromptAr}
                onChange={(e) => setNewPromptAr(e.target.value)}
                className="rounded-lg border border-slate-300 p-2.5 text-sm bg-white"
              />
            </div>

            {(newQType === 'mcq' || newQType === 'sjt') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input placeholder="Option A" value={newOptA} onChange={(e) => setNewOptA(e.target.value)} className="rounded border border-slate-300 px-3 py-1.5 text-xs bg-white" />
                <input placeholder="Option B" value={newOptB} onChange={(e) => setNewOptB(e.target.value)} className="rounded border border-slate-300 px-3 py-1.5 text-xs bg-white" />
                <input placeholder="Option C" value={newOptC} onChange={(e) => setNewOptC(e.target.value)} className="rounded border border-slate-300 px-3 py-1.5 text-xs bg-white" />
                <input placeholder="Option D" value={newOptD} onChange={(e) => setNewOptD(e.target.value)} className="rounded border border-slate-300 px-3 py-1.5 text-xs bg-white" />
                <div className="sm:col-span-2 flex items-center gap-2 text-xs">
                  <span>Correct Option:</span>
                  <select value={newCorrect} onChange={(e) => setNewCorrect(e.target.value)} className="rounded border border-slate-300 px-2 py-1 bg-white">
                    <option value="a">A</option>
                    <option value="b">B</option>
                    <option value="c">C</option>
                    <option value="d">D</option>
                  </select>
                </div>
              </div>
            )}

            {newQType === 'true_false' && (
              <div className="flex items-center gap-2 text-xs">
                <span>Correct Answer:</span>
                <select value={newCorrect} onChange={(e) => setNewCorrect(e.target.value)} className="rounded border border-slate-300 px-2 py-1 bg-white">
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
            )}

            <input
              placeholder="Marking guide / evaluator notes"
              value={newGuide}
              onChange={(e) => setNewGuide(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-xs bg-white"
            />

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddItem(false)} className="px-3 py-1.5 text-xs border rounded-lg bg-white">
                Cancel
              </button>
              <button type="submit" className="px-4 py-1.5 text-xs bg-blue-700 text-white rounded-lg">
                Save Item
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading assessment items...</div>
        ) : itemsInSection.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            {lang === 'ar'
              ? 'لا توجد فقرات في هذا القسم بعد. استخدم الذكاء الاصطناعي أو الإضافة اليدوية.'
              : 'No items in this section yet. Generate tailored questions with AI or add items manually.'}
          </div>
        ) : (
          <div className="space-y-3">
            {itemsInSection.map((item, idx) => {
              const comp = selectedJob?.competencies?.find((c) => c.id === item.competency_id);
              return (
                <div key={item.id} className="border border-slate-200 rounded-xl p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <div className="font-mono tabular-nums">
                      #{idx + 1} · {item.question_type} · {item.max_score} pts ·{' '}
                      <span className="text-slate-700 font-sans font-medium">
                        {comp ? (lang === 'ar' ? comp.name_ar || comp.name : comp.name) : item.competency_id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleItemApprove(item)}
                        className={`px-2.5 py-1 rounded text-xs font-medium border ${
                          item.approved
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {item.approved
                          ? lang === 'ar'
                            ? 'معتمد'
                            : 'Approved'
                          : lang === 'ar'
                            ? 'مسودة — اضغط للاعتماد'
                            : 'Draft — Click to Approve'}
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-1 text-slate-400 hover:text-rose-600"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {item.scenario_context && (
                    <div className="text-xs bg-slate-50 border border-slate-200 rounded p-2.5 text-slate-700">
                      {lang === 'ar' ? item.scenario_context_ar || item.scenario_context : item.scenario_context}
                    </div>
                  )}

                  <div className="text-sm font-semibold text-slate-900">
                    {lang === 'ar' ? item.prompt_ar || item.prompt : item.prompt}
                  </div>

                  {item.options && item.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                      {item.options.map((o) => (
                        <div
                          key={o.id}
                          className={`p-2 rounded border ${
                            o.id === item.correct_answer
                              ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900 font-medium'
                              : 'border-slate-100 bg-slate-50 text-slate-600'
                          }`}
                        >
                          <span className="font-mono uppercase">{o.id}.</span>{' '}
                          {lang === 'ar' ? o.text_ar || o.text : o.text} ({o.score} pts)
                        </div>
                      ))}
                    </div>
                  )}

                  {item.marking_guide && (
                    <div className="text-xs text-slate-600">
                      <strong>{lang === 'ar' ? 'دليل التصحيح:' : 'Marking Guide:'}</strong>{' '}
                      {lang === 'ar' ? item.marking_guide_ar || item.marking_guide : item.marking_guide}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
