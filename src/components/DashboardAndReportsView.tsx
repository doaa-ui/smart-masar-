import React, { useEffect, useState } from 'react';
import { Download, Printer, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { apiRequest, downloadCsv } from '../lib/api';
import { t } from '../i18n/translations';
import {
  CompetencyHeatmap,
  ScoreComparisonChart,
  TechVsBehavioralChart,
  type DashboardCandidateMetric,
} from './Charts';
import type {
  AppLanguage,
  Application,
  AssessmentTemplate,
  Campaign,
  DashboardSummary,
  Job,
} from '../types/domain';

export const DashboardAndReportsView: React.FC<{
  mode: 'dashboard' | 'results' | 'reports';
  jobs: Job[];
  campaigns: Campaign[];
  applications: Application[];
  lang: AppLanguage;
}> = ({ mode, jobs, campaigns, applications, lang }) => {
  const [filterJobId, setFilterJobId] = useState<string>(jobs[0]?.id || 'all');
  const [filterCampaignId, setFilterCampaignId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [allowCrossJob, setAllowCrossJob] = useState(false);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [metrics, setMetrics] = useState<DashboardCandidateMetric[]>([]);
  const [loading, setLoading] = useState(false);

  // Reports state
  const [reportType, setReportType] = useState<'individual' | 'comparative' | 'job_analysis' | 'assessment_tools'>(
    'comparative'
  );
  const [selectedAppId, setSelectedAppId] = useState<string>(applications[0]?.id || '');
  const [jobTemplates, setJobTemplates] = useState<AssessmentTemplate[]>([]);

  useEffect(() => {
    if (filterJobId === 'all' && !allowCrossJob && jobs[0]) {
      setFilterJobId(jobs[0].id);
    }
  }, [jobs, allowCrossJob]);

  useEffect(() => {
    const loadDash = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filterJobId) params.set('job_id', filterJobId);
        if (filterCampaignId) params.set('campaign_id', filterCampaignId);
        if (filterStatus) params.set('status', filterStatus);
        const res = await apiRequest<{
          summary: DashboardSummary;
          candidates: DashboardCandidateMetric[];
        }>(`/api/dashboard?${params.toString()}`);
        setSummary(res.summary);
        setMetrics(res.candidates);
      } catch {
        // handled cleanly
      } finally {
        setLoading(false);
      }
    };
    loadDash();
  }, [filterJobId, filterCampaignId, filterStatus, applications.length]);

  useEffect(() => {
    const targetJobId = filterJobId !== 'all' ? filterJobId : jobs[0]?.id;
    if (mode === 'reports' && targetJobId) {
      apiRequest<{ templates: AssessmentTemplate[] }>(`/api/jobs/${targetJobId}/assessments`)
        .then((r) => setJobTemplates(r.templates))
        .catch(() => {});
    }
  }, [mode, filterJobId, jobs]);

  const activeJob = jobs.find((j) => j.id === filterJobId) || jobs[0] || null;
  const passingThreshold = activeJob?.passing_threshold ?? 70;

  const handleExportComparativeCsv = () => {
    const headers = [
      'Application Code',
      'Candidate Name',
      'Job Title',
      'Sample Demo',
      'Overall Score',
      'Technical %',
      'SJT %',
      'Behavioral %',
      'Practical %',
      'Center %',
      'Critical Passed',
      'Recommendation',
      'Human Decision',
    ];
    const rows = metrics.map((m) => [
      m.application_code,
      m.full_name,
      m.job_title,
      m.is_sample_demo ? 'Yes (Demo)' : 'No',
      m.overall_score ?? '',
      m.section_scores?.technical ?? '',
      m.section_scores?.sjt ?? '',
      m.section_scores?.behavioral ?? '',
      m.section_scores?.practical ?? '',
      m.section_scores?.center ?? '',
      m.critical_passed ? 'Passed' : 'Failed',
      m.final_recommendation,
      m.human_decision,
    ]);
    downloadCsv(`smart-masar-comparative-report.csv`, headers, rows);
  };

  const selectedApplication = applications.find((a) => a.id === selectedAppId) || applications[0] || null;

  return (
    <div className="space-y-6">
      {/* Global Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
              {lang === 'ar' ? 'الوظيفة (مقارنة ضمن نفس الوظيفة)' : 'Job Position (Same-Job Comparison)'}
            </label>
            <select
              value={filterJobId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'all' && !allowCrossJob) return;
                setFilterJobId(v);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white font-medium"
            >
              {allowCrossJob && (
                <option value="all">{lang === 'ar' ? 'كل الوظائف (مقارنة شاملة)' : 'All Jobs (Cross-Job)'}</option>
              )}
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {lang === 'ar' ? j.title_ar || j.title : j.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
              {lang === 'ar' ? 'الحملة التوظيفية' : 'Campaign'}
            </label>
            <select
              value={filterCampaignId}
              onChange={(e) => setFilterCampaignId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
            >
              <option value="all">{t(lang, 'filterAll')}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {lang === 'ar' ? c.title_ar || c.title : c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
              {lang === 'ar' ? 'المرحلة / الحالة' : 'Stage / Status'}
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
            >
              <option value="all">{t(lang, 'filterAll')}</option>
              <option value="applied">applied</option>
              <option value="in_assessment">in_assessment</option>
              <option value="assessment_center">assessment_center</option>
              <option value="final_review">final_review</option>
              <option value="offered">offered</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 pt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={allowCrossJob}
              onChange={(e) => {
                setAllowCrossJob(e.target.checked);
                if (!e.target.checked && filterJobId === 'all' && jobs[0]) {
                  setFilterJobId(jobs[0].id);
                }
              }}
              className="accent-blue-700"
            />
            <span>{lang === 'ar' ? 'السماح بمقارنة وظائف مختلفة' : 'Enable Cross-Job Comparison'}</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportComparativeCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            {t(lang, 'exportCsv')}
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
          >
            <Printer className="w-3.5 h-3.5" />
            {t(lang, 'printPdf')}
          </button>
        </div>
      </div>

      {/* DASHBOARD MODE */}
      {mode === 'dashboard' && summary && (
        <div className="space-y-6">
          {/* 8 KPI Cards (Clean single-elevation grid) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: t(lang, 'totalJobs'), val: summary.total_jobs, color: 'text-slate-900' },
              { label: t(lang, 'activeVacancies'), val: summary.active_vacancies, color: 'text-blue-700' },
              { label: t(lang, 'totalApplicants'), val: summary.total_applicants, color: 'text-slate-900' },
              { label: t(lang, 'underAssessment'), val: summary.under_assessment, color: 'text-cyan-700' },
              { label: t(lang, 'completedAssessments'), val: summary.completed_assessments, color: 'text-slate-900' },
              { label: t(lang, 'meetsRequirements'), val: summary.meets_requirements, color: 'text-emerald-700' },
              { label: t(lang, 'furtherReview'), val: summary.further_review, color: 'text-amber-700' },
              { label: t(lang, 'doesNotMeet'), val: summary.does_not_meet, color: 'text-rose-700' },
            ].map((kpi, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">{kpi.label}</div>
                <div className={`text-2xl font-bold font-mono tabular-nums mt-1 ${kpi.color}`}>
                  {kpi.val}
                </div>
              </div>
            ))}
          </div>

          {/* Sample Demo Data Disclaimer */}
          {metrics.some((m) => m.is_sample_demo) && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3.5 text-xs text-purple-900 flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0 text-purple-700" />
              <span>
                {lang === 'ar'
                  ? 'ملاحظة: المرشحون الموسومون بـ (Sample Demo) هم بيانات تجريبية افتراضية للأغراض الأكاديمية فقط ويمكن تعديلهم أو حذفهم أو إضافة مرشحين ووظائف غير محدودة في أي وقت.'
                  : 'Note: Candidates tagged "Sample Demo" are initial fictional academic demonstration records. You may add unlimited real candidates/jobs or edit/delete sample data at any time.'}
              </span>
            </div>
          )}

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'مقارنة الدرجات الإجمالية للمرشحين' : 'Candidate Overall Score Comparison'}
              </h3>
              <ScoreComparisonChart candidates={metrics} passingThreshold={passingThreshold} lang={lang} />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'الأداء التقني مقابل السلوكي' : 'Technical vs. Behavioral Competency Performance'}
              </h3>
              <TechVsBehavioralChart candidates={metrics} lang={lang} />
            </div>
          </div>

          {/* Competency Heatmap */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              {lang === 'ar' ? 'خريطة الحرارة للكفاءات والحدود الحرجة' : 'Competency Heatmap & Threshold Compliance'}
            </h3>
            <CompetencyHeatmap candidates={metrics} lang={lang} />
          </div>
        </div>
      )}

      {/* RESULTS & RANKING VIEW (Also shown under Dashboard bottom) */}
      {(mode === 'results' || mode === 'dashboard') && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              {lang === 'ar' ? 'الترتيب الشفاف والتفصيل التقييمي للمرشحين' : 'Transparent Candidate Ranking & Decision Support'}
            </h3>
            <span className="text-xs text-slate-500">
              {lang === 'ar' ? 'القرار النهائي بشري بالكامل' : 'Human decision-maker retains final authority'}
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">{t(lang, 'loading')}</div>
          ) : metrics.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">{t(lang, 'noData')}</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {metrics.map((m, idx) => (
                <div key={m.application_id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-slate-400 tabular-nums">
                        #{idx + 1}
                      </span>
                      <div>
                        <div className="font-bold text-slate-900">
                          {m.full_name}
                          {m.is_sample_demo && (
                            <span className="text-xs text-purple-700 font-medium">
                              {' '}· {t(lang, 'sampleDemoBadge')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {m.application_code} · {m.job_title}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 text-xs">
                      <div>
                        <div className="text-slate-500">{t(lang, 'overallScore')}</div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                          {m.overall_score !== null ? `${m.overall_score.toFixed(1)}%` : 'Pending'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">{t(lang, 'criticalThresholds')}</div>
                        <div className={`font-semibold flex items-center gap-1 ${m.critical_passed ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {m.critical_passed ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5" />
                          )}
                          {m.critical_passed ? t(lang, 'passed') : t(lang, 'failed')}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">{lang === 'ar' ? 'التوصية المبدئية' : 'Category'}</div>
                        <div
                          className={`font-semibold ${
                            m.final_recommendation === 'meets_requirements'
                              ? 'text-emerald-700'
                              : m.final_recommendation === 'further_review'
                                ? 'text-amber-700'
                                : m.final_recommendation === 'does_not_meet'
                                  ? 'text-rose-700'
                                  : 'text-slate-600'
                          }`}
                        >
                          {m.final_recommendation}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">{t(lang, 'humanDecision')}</div>
                        <div className="font-semibold text-blue-800">{m.human_decision}</div>
                      </div>
                    </div>
                  </div>

                  {/* Evidence, Strengths & Development Areas */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                    <div>
                      <div className="font-semibold text-emerald-800 mb-1">
                        {lang === 'ar' ? 'نقاط القوة المثبتة' : 'Verified Strengths'}
                      </div>
                      {m.strengths.length > 0 ? (
                        <ul className="space-y-0.5 text-slate-700">
                          {m.strengths.map((s, i) => (
                            <li key={i}>· {s}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-amber-800 mb-1">
                        {lang === 'ar' ? 'مجالات التطوير' : 'Areas for Improvement'}
                      </div>
                      {m.improvement_areas.length > 0 ? (
                        <ul className="space-y-0.5 text-slate-700">
                          {m.improvement_areas.map((s, i) => (
                            <li key={i}>· {s}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-rose-800 mb-1">
                        {lang === 'ar' ? 'سبب النتيجة / تجاوز الحدود' : 'Threshold & Rule Explanation'}
                      </div>
                      {m.threshold_failures.length > 0 ? (
                        <ul className="space-y-0.5 text-rose-700">
                          {m.threshold_failures.map((f, i) => (
                            <li key={i}>· {f}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-emerald-700">
                          {lang === 'ar'
                            ? 'استوفى كافة الحدود الدنيا للكفاءات الحرجة.'
                            : 'All competency & critical thresholds met.'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* REPORTS & EXPORTS MODE */}
      {mode === 'reports' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 no-print">
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'comparative', label: lang === 'ar' ? 'تقرير المقارنة التوظيفية' : 'Comparative Recruitment Report' },
                { key: 'individual', label: lang === 'ar' ? 'تقرير المرشح الفردي' : 'Individual Candidate Report' },
                { key: 'job_analysis', label: lang === 'ar' ? 'تقرير تحليل الوظيفة' : 'Job Analysis Report' },
                { key: 'assessment_tools', label: lang === 'ar' ? 'تقرير أدوات التقييم' : 'Assessment Tools Report' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setReportType(tab.key as typeof reportType)}
                  className={`px-3.5 py-2 text-xs font-medium rounded-lg ${
                    reportType === tab.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {reportType === 'individual' && (
              <select
                value={selectedAppId}
                onChange={(e) => setSelectedAppId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
              >
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.candidate?.full_name} — {a.job_title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {reportType === 'comparative' && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'ar' ? 'التقرير المقارن للمرشحين' : 'Comparative Recruitment Report'} —{' '}
                {activeJob ? (lang === 'ar' ? activeJob.title_ar || activeJob.title : activeJob.title) : ''}
              </h2>
              <CompetencyHeatmap candidates={metrics} lang={lang} />
            </div>
          )}

          {reportType === 'individual' && selectedApplication && (
            <div className="space-y-4 text-sm">
              <div className="border-b border-slate-200 pb-3">
                <h2 className="text-lg font-bold text-slate-900">
                  {selectedApplication.candidate?.full_name} ({selectedApplication.application_code})
                </h2>
                <div className="text-xs text-slate-500">
                  {selectedApplication.job_title} · {selectedApplication.candidate?.email} ·{' '}
                  {selectedApplication.candidate?.phone}
                </div>
              </div>
              {selectedApplication.latest_attempt ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-lg text-xs">
                    <div>
                      <span className="text-slate-500">Overall Score</span>
                      <div className="text-lg font-bold font-mono">{selectedApplication.latest_attempt.overall_score}%</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Category</span>
                      <div className="font-bold">{selectedApplication.final_recommendation}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Critical Thresholds</span>
                      <div className="font-bold">{selectedApplication.latest_attempt.critical_passed ? 'Passed' : 'Failed'}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Human Decision</span>
                      <div className="font-bold text-blue-800">{selectedApplication.human_decision}</div>
                    </div>
                  </div>
                  {selectedApplication.evaluation_report && (
                    <div className="border border-slate-200 rounded-lg p-4 text-xs whitespace-pre-line">
                      <strong>Evaluation Summary:</strong>
                      <div className="mt-1">{selectedApplication.evaluation_report.ai_summary}</div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-500">No assessment attempt recorded yet.</p>
              )}
            </div>
          )}

          {reportType === 'job_analysis' && activeJob && (
            <div className="space-y-4 text-sm">
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'ar' ? activeJob.title_ar || activeJob.title : activeJob.title}
              </h2>
              <p className="text-slate-700">{lang === 'ar' ? activeJob.purpose_ar || activeJob.purpose : activeJob.purpose}</p>
              <div>
                <h3 className="font-bold text-slate-900 mb-1">Competency Matrix (100%)</h3>
                <table className="w-full text-xs border border-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-2 text-start">Competency</th>
                      <th className="p-2 text-start">Category</th>
                      <th className="p-2 text-center">Weight</th>
                      <th className="p-2 text-center">Threshold</th>
                      <th className="p-2 text-start">Assessment Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(activeJob.competencies || []).map((c) => (
                      <tr key={c.id}>
                        <td className="p-2 font-medium">{lang === 'ar' ? c.name_ar || c.name : c.name}</td>
                        <td className="p-2">{c.category}</td>
                        <td className="p-2 text-center font-mono">{c.weight}%</td>
                        <td className="p-2 text-center font-mono">{c.min_threshold}%</td>
                        <td className="p-2">{c.assessment_method}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportType === 'assessment_tools' && (
            <div className="space-y-4 text-sm">
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'ar' ? 'تقرير أدوات التقييم والاختبارات المعتمدة' : 'Assessment Tools & Rubrics Report'}
              </h2>
              {(jobTemplates[0]?.items || []).map((it, idx) => (
                <div key={it.id} className="border border-slate-200 rounded-lg p-3.5 text-xs space-y-1">
                  <div className="font-mono text-slate-500">
                    #{idx + 1} · {it.section_type} · {it.question_type} · {it.max_score} pts
                  </div>
                  <div className="font-semibold text-slate-900">{lang === 'ar' ? it.prompt_ar || it.prompt : it.prompt}</div>
                  {it.marking_guide && <div className="text-slate-600">Guide: {it.marking_guide}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
