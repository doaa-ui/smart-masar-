import React from 'react';
import type { AppLanguage, CompetencyScoreBreakdown, SectionScores } from '../types/domain';

export interface DashboardCandidateMetric {
  application_id: string;
  application_code: string;
  job_id: string;
  job_title: string;
  candidate_id: string;
  candidate_code: string;
  full_name: string;
  is_sample_demo: boolean;
  status: string;
  human_decision: string;
  final_recommendation: string;
  overall_score: number | null;
  section_scores: SectionScores | null;
  competency_scores: CompetencyScoreBreakdown[];
  critical_passed: boolean;
  threshold_passed: boolean;
  threshold_failures: string[];
  strengths: string[];
  improvement_areas: string[];
}

export const ScoreComparisonChart: React.FC<{
  candidates: DashboardCandidateMetric[];
  passingThreshold: number;
  lang: AppLanguage;
}> = ({ candidates, passingThreshold, lang }) => {
  const scored = candidates.filter((c) => c.overall_score !== null);
  if (scored.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        {lang === 'ar' ? 'لا توجد نتائج تقييم مكتملة للمقارنة بعد.' : 'No completed assessment scores available for comparison yet.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {lang === 'ar'
            ? `خط النجاح المعتمد: ${passingThreshold}%`
            : `Configured Passing Threshold: ${passingThreshold}%`}
        </span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" />
            {lang === 'ar' ? 'مستوفٍ' : 'Meets'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
            {lang === 'ar' ? 'مراجعة' : 'Review'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-600" />
            {lang === 'ar' ? 'دون المطلوب' : 'Below'}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {scored.map((c) => {
          const score = c.overall_score ?? 0;
          const barColor =
            c.final_recommendation === 'meets_requirements'
              ? 'bg-emerald-600'
              : c.final_recommendation === 'further_review'
                ? 'bg-amber-500'
                : 'bg-rose-600';

          return (
            <div key={c.application_id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="font-medium text-slate-900 truncate">{c.full_name}</span>
                  {c.is_sample_demo && (
                    <span className="text-xs text-purple-700 font-medium">
                      · {lang === 'ar' ? 'نموذج تجريبي' : 'Demo'}
                    </span>
                  )}
                </div>
                <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {score.toFixed(1)}%
                </span>
              </div>
              <div className="relative h-3 w-full rounded bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded transition-all duration-300 ${barColor}`}
                  style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-900/70"
                  style={{ insetInlineStart: `${passingThreshold}%` }}
                  title={`${passingThreshold}%`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const TechVsBehavioralChart: React.FC<{
  candidates: DashboardCandidateMetric[];
  lang: AppLanguage;
}> = ({ candidates, lang }) => {
  const scored = candidates.filter((c) => c.competency_scores && c.competency_scores.length > 0);
  if (scored.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        {lang === 'ar' ? 'لا توجد بيانات كفاءات تقنية وسلوكية بعد.' : 'No competency breakdown available yet.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-700" />
          {lang === 'ar' ? 'الكفاءات التقنية' : 'Technical Competencies'}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-cyan-600" />
          {lang === 'ar' ? 'الكفاءات السلوكية' : 'Behavioral Competencies'}
        </span>
      </div>

      <div className="space-y-3.5">
        {scored.map((c) => {
          const tech = c.competency_scores.filter((x) => x.category === 'Technical');
          const beh = c.competency_scores.filter((x) => x.category === 'Behavioral');
          const techAvg = tech.length
            ? tech.reduce((s, x) => s + x.score, 0) / tech.length
            : 0;
          const behAvg = beh.length
            ? beh.reduce((s, x) => s + x.score, 0) / beh.length
            : 0;

          return (
            <div key={c.application_id} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-800">
                <span className="truncate">{c.full_name}</span>
                <span className="font-mono tabular-nums text-slate-500">
                  T: {techAvg.toFixed(0)}% / B: {behAvg.toFixed(0)}%
                </span>
              </div>
              <div className="space-y-1">
                <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                  <div className="h-full bg-blue-700 rounded" style={{ width: `${techAvg}%` }} />
                </div>
                <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                  <div className="h-full bg-cyan-600 rounded" style={{ width: `${behAvg}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const CompetencyHeatmap: React.FC<{
  candidates: DashboardCandidateMetric[];
  lang: AppLanguage;
}> = ({ candidates, lang }) => {
  const withComps = candidates.filter((c) => c.competency_scores && c.competency_scores.length > 0);
  if (withComps.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        {lang === 'ar' ? 'ستظهر مصفوفة الحرارة عند اكتمال التقييمات.' : 'Competency heatmap will populate once assessments are scored.'}
      </div>
    );
  }

  const columns = withComps[0].competency_scores;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-slate-600">
            <th className="py-2.5 px-3 text-start font-semibold min-w-[160px]">
              {lang === 'ar' ? 'المرشح' : 'Candidate'}
            </th>
            {columns.map((col) => (
              <th key={col.competency_id} className="py-2.5 px-2 text-center font-medium min-w-[96px]">
                <div className="truncate max-w-[110px] mx-auto" title={lang === 'ar' ? col.competency_name_ar : col.competency_name}>
                  {lang === 'ar' ? col.competency_name_ar || col.competency_name : col.competency_name}
                </div>
                <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                  {col.weight}% {col.is_critical ? (lang === 'ar' ? '· حرج' : '· Crit') : ''}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {withComps.map((c) => (
            <tr key={c.application_id} className="hover:bg-slate-50">
              <td className="py-2.5 px-3 font-medium text-slate-900">
                {c.full_name}
              </td>
              {columns.map((col) => {
                const match = c.competency_scores.find(
                  (cs) => cs.competency_id === col.competency_id || cs.competency_name === col.competency_name
                );
                if (!match) {
                  return (
                    <td key={col.competency_id} className="py-2 px-2 text-center text-slate-400 font-mono">
                      —
                    </td>
                  );
                }
                const cellBg = !match.meets_threshold
                  ? 'bg-rose-50 text-rose-800 border border-rose-200'
                  : match.score >= 85
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : match.score >= 70
                      ? 'bg-cyan-50 text-cyan-900 border border-cyan-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200';

                return (
                  <td key={col.competency_id} className="py-2 px-1.5 text-center">
                    <div className={`rounded py-1 px-1.5 font-mono font-semibold tabular-nums ${cellBg}`}>
                      {match.score.toFixed(0)}%
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
