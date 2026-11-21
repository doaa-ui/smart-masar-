import { GoogleGenAI, Type } from '@google/genai';
import type {
  AIJobAnalysis,
  AssessmentItem,
  AssessmentSectionType,
  Competency,
  Job,
} from '../src/types/domain.ts';

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    const err = new Error(
      'GEMINI_API_KEY is not configured. Please set a valid Gemini API key in Settings > Secrets.'
    );
    (err as Error & { code?: string }).code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function analyzeJobDescriptionWithAI(params: {
  title: string;
  department: string;
  rawJdText: string;
}): Promise<AIJobAnalysis> {
  const ai = getAIClient();

  const prompt = `Analyze the following job description for the role "${params.title}" in department "${params.department}".
Extract structured HR job analysis data in both English and Arabic (professional HR Arabic).
CRITICAL REQUIREMENT: The sum of weights across all technical_competencies and behavioral_competencies combined MUST equal exactly 100.
Do NOT invent clinical psychological tests; keep behavioral competencies strictly workplace-oriented and non-diagnostic.

Job Description Text:
${params.rawJdText}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are an expert Industrial-Organizational Psychologist and Senior HR Talent Architect. Produce accurate, bilingual (English & Arabic) structured job analysis and competency matrices where weights sum to exactly 100.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          purpose: { type: Type.STRING },
          purpose_ar: { type: Type.STRING },
          responsibilities: { type: Type.ARRAY, items: { type: Type.STRING } },
          qualifications: { type: Type.ARRAY, items: { type: Type.STRING } },
          experience_req: { type: Type.STRING },
          technical_competencies: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                name_ar: { type: Type.STRING },
                description: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                importance: { type: Type.STRING },
                assessment_method: { type: Type.STRING },
                expected_level: { type: Type.STRING },
                min_threshold: { type: Type.NUMBER },
              },
            },
          },
          behavioral_competencies: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                name_ar: { type: Type.STRING },
                description: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                importance: { type: Type.STRING },
                assessment_method: { type: Type.STRING },
                expected_level: { type: Type.STRING },
                min_threshold: { type: Type.NUMBER },
              },
            },
          },
          performance_indicators: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommended_assessment_methods: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as AIJobAnalysis;

  // Normalize weights to guarantee exact 100% sum
  const allComps = [
    ...(parsed.technical_competencies || []),
    ...(parsed.behavioral_competencies || []),
  ];
  const currentSum = allComps.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
  if (allComps.length > 0 && currentSum > 0 && currentSum !== 100) {
    let running = 0;
    for (let i = 0; i < allComps.length; i++) {
      if (i === allComps.length - 1) {
        allComps[i].weight = Math.max(1, 100 - running);
      } else {
        const scaled = Math.max(1, Math.round(((Number(allComps[i].weight) || 10) / currentSum) * 100));
        allComps[i].weight = scaled;
        running += scaled;
      }
    }
  }

  return parsed;
}

export async function generateAssessmentItemsWithAI(params: {
  job: Job;
  competencies: Competency[];
  sectionType: AssessmentSectionType;
  count?: number;
}): Promise<Partial<AssessmentItem>[]> {
  const ai = getAIClient();
  const count = params.count ?? (params.sectionType === 'practical' ? 1 : 3);

  const compListText = params.competencies
    .map((c) => `- ID: "${c.id}" | Name: "${c.name}" (${c.category}, Weight: ${c.weight}%)`)
    .join('\n');

  let sectionInstructions = '';
  if (params.sectionType === 'technical') {
    sectionInstructions = `Generate ${count} Professional/Technical Knowledge Test questions tailored specifically to the job "${params.job.title}".
Include a mix of question_type ("mcq", "true_false", "short_answer").
For mcq: provide 4 options with ids "a","b","c","d", set correct_answer to the winning option id, and score=max_score on the right option and 0 on others.
For true_false: provide 2 options ("true","false"), set correct_answer to "true" or "false".
For short_answer: options=[], set marking_guide with clear scoring criteria.`;
  } else if (params.sectionType === 'sjt') {
    sectionInstructions = `Generate ${count} realistic Situational Judgment Test (SJT) workplace scenarios specifically for "${params.job.title}".
Set question_type="sjt", max_score=10, scenario_context with the workplace dilemma, prompt with the question, and 4 response options ("a","b","c","d") graded from 10 (best) down to 2 (least effective) using each option's "score" field.`;
  } else if (params.sectionType === 'behavioral') {
    sectionInstructions = `Generate ${count} non-diagnostic workplace Behavioral Assessment statements (5-point Likert scale) specifically linked to "${params.job.title}" behavioral competencies.
IMPORTANT: Never generate clinical or mental health diagnoses. Focus strictly on workplace behaviors (accountability, integrity, teamwork, adaptability, communication).
Set question_type="likert", max_score=5, and provide 5 options: Strongly Disagree (1), Disagree (2), Neutral (3), Agree (4), Strongly Agree (5).`;
  } else {
    sectionInstructions = `Generate ${count} realistic Practical / Work Sample Assessment task simulating actual "${params.job.title}" deliverables.
Set question_type="practical_task", max_score=30, time_limit_minutes=45, include detailed instructions in prompt/prompt_ar, sample dataset or scenario resources in resources, expected_output, and 3 rubric criteria totaling 30 points.`;
  }

  const prompt = `Job Title: ${params.job.title} (${params.job.title_ar})
Department: ${params.job.department}
Purpose: ${params.job.purpose}
Key Responsibilities: ${params.job.responsibilities.join('; ')}

Approved Competency Matrix (MUST map each generated item's competency_id to one of these exact IDs):
${compListText}

Task:
${sectionInstructions}
Provide both English and Arabic fields (prompt & prompt_ar, option text & text_ar, marking_guide & marking_guide_ar).`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a Senior Psychometrician and HR Assessment Designer. Generate rigorous, job-specific, bilingual assessment items mapped accurately to the provided competency IDs.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question_type: { type: Type.STRING },
            prompt: { type: Type.STRING },
            prompt_ar: { type: Type.STRING },
            scenario_context: { type: Type.STRING },
            scenario_context_ar: { type: Type.STRING },
            competency_id: { type: Type.STRING },
            max_score: { type: Type.NUMBER },
            difficulty: { type: Type.STRING },
            correct_answer: { type: Type.STRING },
            marking_guide: { type: Type.STRING },
            marking_guide_ar: { type: Type.STRING },
            explanation: { type: Type.STRING },
            expected_output: { type: Type.STRING },
            time_limit_minutes: { type: Type.NUMBER },
            resources: { type: Type.ARRAY, items: { type: Type.STRING } },
            options: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                  text_ar: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                },
              },
            },
            rubric: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  criterion: { type: Type.STRING },
                  criterion_ar: { type: Type.STRING },
                  max_points: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    },
  });

  const raw = (response.text ?? '[]').trim();
  const items = JSON.parse(raw) as Partial<AssessmentItem>[];
  const validCompIds = new Set(params.competencies.map((c) => c.id));
  const fallbackCompId = params.competencies[0]?.id || '';

  return items.map((item) => ({
    ...item,
    section_type: params.sectionType,
    competency_id:
      item.competency_id && validCompIds.has(item.competency_id)
        ? item.competency_id
        : fallbackCompId,
    approved: false,
  }));
}

export async function draftCandidateEvaluationWithAI(params: {
  candidateName: string;
  jobTitle: string;
  overallScore: number;
  evaluationCategory: string;
  sectionScores: Record<string, number | null>;
  competencyBreakdown: Array<{
    competency_name: string;
    score: number;
    min_threshold: number;
    is_critical: boolean;
    meets_threshold: boolean;
  }>;
  practicalSubmission: string;
  assessorObservations: string[];
}): Promise<{ summary: string; strengths: string[]; improvement_areas: string[] }> {
  const ai = getAIClient();

  const prompt = `Draft a structured, evidence-based HR evaluation summary for human review.
STRICT RULES:
1. Base every statement ONLY on the recorded scores, practical submission, and assessor observations below.
2. NEVER invent qualifications, past experience, or unseen answers.
3. NEVER issue a final hire/reject command — present objective decision-support findings for the human hiring committee.
4. Provide a concise bilingual executive summary (English paragraph followed by Arabic paragraph), plus 3-4 concrete strengths and 3-4 development/improvement areas.

Candidate: ${params.candidateName}
Applied Job: ${params.jobTitle}
Computed Overall Score: ${params.overallScore}/100
Rule-Based Category: ${params.evaluationCategory}
Section Scores: ${JSON.stringify(params.sectionScores)}
Competency Breakdown: ${JSON.stringify(params.competencyBreakdown)}
Recorded Practical Submission Excerpt: ${params.practicalSubmission.slice(0, 1200) || 'None recorded'}
Recorded Assessor Observations: ${params.assessorObservations.join(' | ') || 'None recorded'}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are an objective Talent Assessment Analyst preparing a human-reviewed evaluation brief. Rely strictly on provided evidence and highlight critical competency thresholds transparently.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvement_areas: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  return JSON.parse(raw) as {
    summary: string;
    strengths: string[];
    improvement_areas: string[];
  };
}
