import type {
  AssessmentAttempt,
  AssessmentItem,
  AssessmentWeights,
  AssessorEvaluation,
  CandidateAnswerRecord,
  Competency,
  CompetencyScoreBreakdown,
  EvaluationCategory,
  SectionScores,
} from '../src/types/domain.ts';

export interface ScoringInput {
  items: AssessmentItem[];
  competencies: Competency[];
  answers: Record<string, CandidateAnswerRecord>;
  practicalSubmissionText: string;
  assessorEvaluations: AssessorEvaluation[];
  assessmentWeights: AssessmentWeights;
  passingThreshold: number;
}

export interface ScoringOutput {
  section_scores: SectionScores;
  competency_scores: CompetencyScoreBreakdown[];
  overall_score: number;
  threshold_passed: boolean;
  critical_passed: boolean;
  evaluation_category: EvaluationCategory;
  strengths: string[];
  improvement_areas: string[];
  threshold_failures: string[];
  updated_answers: Record<string, CandidateAnswerRecord>;
}

function clamp100(val: number): number {
  return Math.max(0, Math.min(100, Math.round(val * 10) / 10));
}

export function computeCandidateScoring(input: ScoringInput): ScoringOutput {
  const {
    items,
    competencies,
    answers,
    practicalSubmissionText,
    assessorEvaluations,
    assessmentWeights,
    passingThreshold,
  } = input;

  const updatedAnswers: Record<string, CandidateAnswerRecord> = { ...answers };

  // 1. Score each assessment item
  const sectionTotals: Record<'technical' | 'sjt' | 'behavioral' | 'practical', { earned: number; max: number }> = {
    technical: { earned: 0, max: 0 },
    sjt: { earned: 0, max: 0 },
    behavioral: { earned: 0, max: 0 },
    practical: { earned: 0, max: 0 },
  };

  const compEarned: Record<string, { earned: number; max: number; sources: Set<string> }> = {};
  for (const c of competencies) {
    compEarned[c.id] = { earned: 0, max: 0, sources: new Set<string>() };
  }

  for (const item of items) {
    const ans = updatedAnswers[item.id] || { item_id: item.id };
    let awarded = 0;

    if (typeof ans.awarded_score === 'number' && !Number.isNaN(ans.awarded_score)) {
      // Human-evaluated or pre-scored score
      awarded = Math.max(0, Math.min(item.max_score, ans.awarded_score));
    } else if (item.question_type === 'mcq' || item.question_type === 'true_false') {
      if (ans.selected_option_id && ans.selected_option_id === item.correct_answer) {
        awarded = item.max_score;
      } else {
        awarded = 0;
      }
      updatedAnswers[item.id] = { ...ans, awarded_score: awarded };
    } else if (item.question_type === 'sjt' || item.question_type === 'scenario' || item.question_type === 'likert') {
      const selectedOpt = item.options.find((o) => o.id === ans.selected_option_id);
      if (selectedOpt) {
        awarded = Math.max(0, Math.min(item.max_score, selectedOpt.score));
      } else if (item.question_type === 'scenario' && ans.text_response && ans.text_response.trim().length > 20) {
        // Default partial score awaiting evaluator rubric confirmation
        awarded = Math.round(item.max_score * 0.6);
      }
      updatedAnswers[item.id] = { ...ans, awarded_score: awarded };
    } else if (item.question_type === 'short_answer') {
      const resp = (ans.text_response || '').trim();
      if (resp.length > 0 && typeof ans.awarded_score !== 'number') {
        // Pending manual grading: give provisional 0 until graded or preserve existing
        awarded = 0;
      }
    } else if (item.question_type === 'practical_task') {
      const resp = (ans.text_response || practicalSubmissionText || '').trim();
      if (resp.length > 0 && typeof ans.awarded_score !== 'number') {
        awarded = 0;
      }
    }

    const sec = item.section_type;
    if (sectionTotals[sec]) {
      sectionTotals[sec].earned += awarded;
      sectionTotals[sec].max += item.max_score;
    }

    if (item.competency_id && compEarned[item.competency_id]) {
      compEarned[item.competency_id].earned += awarded;
      compEarned[item.competency_id].max += item.max_score;
      compEarned[item.competency_id].sources.add(
        sec === 'technical'
          ? 'Technical Test'
          : sec === 'sjt'
            ? 'Situational Judgment Test'
            : sec === 'behavioral'
              ? 'Behavioral Assessment'
              : 'Practical Work Sample'
      );
    }
  }

  // 2. Compute Assessment Center score and incorporate assessor competency ratings
  let centerScore: number | null = null;
  if (assessorEvaluations.length > 0) {
    let ratingSum = 0;
    let ratingCount = 0;

    for (const ev of assessorEvaluations) {
      if (typeof ev.overall_rating === 'number' && ev.overall_rating > 0) {
        ratingSum += ev.overall_rating;
        ratingCount += 1;
      }
      for (const [compId, ratingObj] of Object.entries(ev.competency_ratings || {})) {
        if (compEarned[compId] && typeof ratingObj.score === 'number') {
          compEarned[compId].earned += ratingObj.score;
          compEarned[compId].max += 100;
          compEarned[compId].sources.add('Assessment Center Observation');
        }
      }
    }

    if (ratingCount > 0) {
      // overall_rating can be on 0-100 or 1-5 scale; normalize cleanly
      const avg = ratingSum / ratingCount;
      centerScore = avg <= 5 ? clamp100((avg / 5) * 100) : clamp100(avg);
    }
  }

  const sectionScores: SectionScores = {
    technical:
      sectionTotals.technical.max > 0
        ? clamp100((sectionTotals.technical.earned / sectionTotals.technical.max) * 100)
        : null,
    sjt:
      sectionTotals.sjt.max > 0
        ? clamp100((sectionTotals.sjt.earned / sectionTotals.sjt.max) * 100)
        : null,
    behavioral:
      sectionTotals.behavioral.max > 0
        ? clamp100((sectionTotals.behavioral.earned / sectionTotals.behavioral.max) * 100)
        : null,
    practical:
      sectionTotals.practical.max > 0
        ? clamp100((sectionTotals.practical.earned / sectionTotals.practical.max) * 100)
        : null,
    center: centerScore,
  };

  // 3. Build Competency Breakdown
  const competencyScores: CompetencyScoreBreakdown[] = [];
  let weightedCompetencyTotal = 0;
  let totalWeightCovered = 0;

  for (const comp of competencies) {
    const bucket = compEarned[comp.id];
    let score = 0;
    if (bucket && bucket.max > 0) {
      score = clamp100((bucket.earned / bucket.max) * 100);
    } else {
      // Fallback to category section average if no direct items were mapped yet
      const fallbackSection =
        comp.category === 'Technical' ? sectionScores.technical : sectionScores.behavioral;
      score = fallbackSection ?? 0;
    }

    const meetsThreshold = comp.min_threshold > 0 ? score >= comp.min_threshold : true;
    const weightedContribution = Math.round(((score * comp.weight) / 100) * 100) / 100;
    weightedCompetencyTotal += weightedContribution;
    totalWeightCovered += comp.weight;

    competencyScores.push({
      competency_id: comp.id,
      competency_name: comp.name,
      competency_name_ar: comp.name_ar,
      category: comp.category,
      weight: comp.weight,
      is_critical: comp.is_critical,
      min_threshold: comp.min_threshold,
      score,
      weighted_contribution: weightedContribution,
      meets_threshold: meetsThreshold,
      evidence_sources: Array.from(bucket?.sources || []),
    });
  }

  // 4. Compute Overall Score using configured Assessment Weights (re-normalizing active sections if center not yet conducted)
  const activeWeightPairs: Array<{ score: number; weight: number }> = [];
  if (sectionScores.technical !== null && assessmentWeights.technical > 0) {
    activeWeightPairs.push({ score: sectionScores.technical, weight: assessmentWeights.technical });
  }
  if (sectionScores.sjt !== null && assessmentWeights.sjt > 0) {
    activeWeightPairs.push({ score: sectionScores.sjt, weight: assessmentWeights.sjt });
  }
  if (sectionScores.behavioral !== null && assessmentWeights.behavioral > 0) {
    activeWeightPairs.push({ score: sectionScores.behavioral, weight: assessmentWeights.behavioral });
  }
  if (sectionScores.practical !== null && assessmentWeights.practical > 0) {
    activeWeightPairs.push({ score: sectionScores.practical, weight: assessmentWeights.practical });
  }
  if (sectionScores.center !== null && assessmentWeights.center > 0) {
    activeWeightPairs.push({ score: sectionScores.center, weight: assessmentWeights.center });
  }

  let sectionWeightedOverall = 0;
  if (activeWeightPairs.length > 0) {
    const activeWeightSum = activeWeightPairs.reduce((acc, p) => acc + p.weight, 0);
    sectionWeightedOverall =
      activeWeightPairs.reduce((acc, p) => acc + p.score * p.weight, 0) / activeWeightSum;
  }

  // Combine transparent assessment-section weighted score (60%) and competency matrix weighted score (40%)
  // or pure section score if competencies aren't configured yet
  const overallScore =
    totalWeightCovered > 0
      ? clamp100(sectionWeightedOverall * 0.5 + weightedCompetencyTotal * 0.5)
      : clamp100(sectionWeightedOverall);

  // 5. Evaluate Critical Thresholds & Mandatory Decision Support Rules
  const thresholdFailures: string[] = [];
  let criticalPassed = true;

  for (const cs of competencyScores) {
    if (!cs.meets_threshold) {
      thresholdFailures.push(
        `${cs.competency_name} (${cs.score}% < required ${cs.min_threshold}%)`
      );
      if (cs.is_critical) {
        criticalPassed = false;
      }
    }
  }

  const thresholdPassed = overallScore >= passingThreshold;

  // CRITICAL RULE: A candidate with a high overall score must NOT automatically pass
  // if they fail a mandatory critical competency threshold.
  let evaluationCategory: EvaluationCategory = 'does_not_meet';
  if (thresholdPassed && criticalPassed && thresholdFailures.length === 0) {
    evaluationCategory = 'meets_requirements';
  } else if (overallScore >= Math.max(55, passingThreshold - 15)) {
    evaluationCategory = 'further_review';
  } else {
    evaluationCategory = 'does_not_meet';
  }

  // 6. Extract Evidence-Grounded Strengths & Improvement Areas
  const sortedComps = [...competencyScores].sort((a, b) => b.score - a.score);
  const strengths = sortedComps
    .filter((c) => c.score >= 75 && c.meets_threshold)
    .slice(0, 4)
    .map((c) => `${c.competency_name} (${c.score}% — ${c.evidence_sources.join(', ') || 'Assessed'})`);

  const improvementAreas = sortedComps
    .filter((c) => c.score < 75 || !c.meets_threshold)
    .reverse()
    .slice(0, 4)
    .map(
      (c) =>
        `${c.competency_name} (${c.score}%${c.min_threshold > 0 ? ` vs threshold ${c.min_threshold}%` : ''})`
    );

  return {
    section_scores: sectionScores,
    competency_scores: competencyScores,
    overall_score: overallScore,
    threshold_passed: thresholdPassed,
    critical_passed: criticalPassed,
    evaluation_category: evaluationCategory,
    strengths,
    improvement_areas: improvementAreas,
    threshold_failures: thresholdFailures,
    updated_answers: updatedAnswers,
  };
}
