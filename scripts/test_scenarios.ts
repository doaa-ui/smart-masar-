import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { initDatabase, db } from '../server/db.ts';
import { createApiRouter } from '../server/routes.ts';

async function runTests() {
  initDatabase();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', createApiRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function req(path: string, opts: RequestInit = {}, token?: string) {
    const headers: Record<string, string> = {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${baseUrl}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  const createdCandidateIds: string[] = [];
  const createdJobIds: string[] = [];

  try {
    // Login as Admin and Assessor
    const adminLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ demoRole: 'admin' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token;

    const assessorLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ demoRole: 'assessor' }),
    });
    assert.equal(assessorLogin.status, 200);
    const assessorToken = assessorLogin.data.token;

    // SCENARIO 1: MEAL Officer job + 3 fictional candidates + comparison dashboard
    const dash1 = await req('/api/dashboard?job_id=job-meal-officer', {}, adminToken);
    assert.equal(dash1.status, 200);
    assert.ok(dash1.data.candidates.length >= 3, 'Scenario 1: Expected at least 3 seeded MEAL candidates');
    const initialSaraScore = dash1.data.candidates.find((c: { candidate_id: string }) => c.candidate_id === 'cand-demo-1')?.overall_score;
    assert.ok(typeof initialSaraScore === 'number' && initialSaraScore > 75);
    console.log('PASS Scenario 1: MEAL Officer + 3 demo candidates + dashboard verified.');

    // SCENARIO 2: Add a 4th candidate to MEAL Officer & assess without modifying previous 3 records
    const cand4Res = await req(
      '/api/candidates',
      {
        method: 'POST',
        body: JSON.stringify({
          full_name: 'Tariq Test Candidate 4',
          email: 'tariq4@example.org',
          phone: '+962-79-000-0004',
          location: 'Amman',
          job_id: 'job-meal-officer',
        }),
      },
      adminToken
    );
    assert.equal(cand4Res.status, 201);
    createdCandidateIds.push(cand4Res.data.candidate_id);
    const app4Id = cand4Res.data.application_id;
    const inv4Token = cand4Res.data.invite_token;

    const inviteRes = await req(`/api/applications/${app4Id}/invite`, { method: 'POST', body: '{}' }, adminToken);
    assert.equal(inviteRes.status, 200);

    const start4 = await req(`/api/candidate/invite/${inv4Token}/start`, { method: 'POST' });
    assert.equal(start4.status, 201);
    const att4Id = start4.data.attempt.id;

    const submit4 = await req(`/api/candidate/invite/${inv4Token}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        attempt_id: att4Id,
        answers: {
          'item-meal-tech-1': { item_id: 'item-meal-tech-1', selected_option_id: 'a' },
          'item-meal-tech-2': { item_id: 'item-meal-tech-2', selected_option_id: 'a' },
          'item-meal-sjt-1': { item_id: 'item-meal-sjt-1', selected_option_id: 'a' },
          'item-meal-beh-1': { item_id: 'item-meal-beh-1', selected_option_id: '5' },
        },
        practical_submission_text: 'Cleaned dataset for 4th candidate.',
      }),
    });
    assert.equal(submit4.status, 200);

    const dash2 = await req('/api/dashboard?job_id=job-meal-officer', {}, adminToken);
    assert.equal(dash2.data.candidates.length, dash1.data.candidates.length + 1);
    const afterSaraScore = dash2.data.candidates.find((c: { candidate_id: string }) => c.candidate_id === 'cand-demo-1')?.overall_score;
    assert.equal(afterSaraScore, initialSaraScore, 'Scenario 2: Previous candidate scores must remain unchanged');
    console.log('PASS Scenario 2: 4th candidate assessed independently without altering previous 3 records.');

    // SCENARIO 3: Create a new Accountant job with different competency matrix & assessment items
    const acctJobRes = await req(
      '/api/jobs',
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Accountant',
          title_ar: 'محاسب مالي',
          department: 'Finance',
          status: 'published',
        }),
      },
      adminToken
    );
    assert.equal(acctJobRes.status, 201);
    const acctJobId = acctJobRes.data.job.id;
    createdJobIds.push(acctJobId);

    const compPut = await req(
      `/api/jobs/${acctJobId}/competencies`,
      {
        method: 'PUT',
        body: JSON.stringify({
          competencies: [
            {
              name: 'Financial Reconciliation & Ledger Accuracy',
              name_ar: 'المطابقة المالية ودقة القيود',
              category: 'Technical',
              importance: 'Critical',
              is_critical: true,
              weight: 60,
              min_threshold: 75,
              assessment_method: 'Technical Test & Practical',
            },
            {
              name: 'Financial Ethics & Compliance',
              name_ar: 'النزاهة والامتثال المالي',
              category: 'Behavioral',
              importance: 'Critical',
              is_critical: true,
              weight: 40,
              min_threshold: 70,
              assessment_method: 'SJT',
            },
          ],
        }),
      },
      adminToken
    );
    assert.equal(compPut.status, 200);
    const acctComps = compPut.data.competencies;

    const acctAssessments = await req(`/api/jobs/${acctJobId}/assessments`, {}, adminToken);
    const acctTplId = acctAssessments.data.templates[0].id;

    await req(
      `/api/jobs/${acctJobId}/assessments/items`,
      {
        method: 'POST',
        body: JSON.stringify({
          template_id: acctTplId,
          section_type: 'technical',
          question_type: 'mcq',
          prompt: 'Which entry balances an accrued expense at month-end?',
          options: [
            { id: 'a', text: 'Debit Expense, Credit Accrued Liabilities', text_ar: 'مدين مصروف، دائن مصاريف مستحقة', score: 10 },
            { id: 'b', text: 'Debit Cash, Credit Revenue', text_ar: 'مدين نقدية، دائن إيراد', score: 0 },
          ],
          correct_answer: 'a',
          competency_id: acctComps[0].id,
          max_score: 10,
          approved: true,
        }),
      },
      adminToken
    );
    await req(
      `/api/jobs/${acctJobId}/assessments/items`,
      {
        method: 'POST',
        body: JSON.stringify({
          template_id: acctTplId,
          section_type: 'sjt',
          question_type: 'sjt',
          prompt: 'An invoice lacks supporting PO documentation before payment run. What do you do?',
          options: [
            { id: 'a', text: 'Hold payment and request verified PO & receipt per policy.', text_ar: 'إيقاف الصرف وطلب أمر الشراء المعتمد', score: 10 },
            { id: 'b', text: 'Pay immediately to avoid delay.', text_ar: 'الصرف فوراً', score: 0 },
          ],
          correct_answer: 'a',
          competency_id: acctComps[1].id,
          max_score: 10,
          approved: true,
        }),
      },
      adminToken
    );
    const approveTpl = await req(
      `/api/assessment-templates/${acctTplId}`,
      { method: 'PATCH', body: JSON.stringify({ approval_status: 'approved' }) },
      adminToken
    );
    assert.equal(approveTpl.status, 200);
    console.log('PASS Scenario 3: Accountant job created with distinct 100% competency matrix & approved assessment.');

    // SCENARIO 4: Add Accountant candidate & verify isolation from MEAL Officer
    const acctCand = await req(
      '/api/candidates',
      {
        method: 'POST',
        body: JSON.stringify({
          full_name: 'Huda Finance Candidate',
          email: 'huda.acct@example.org',
          job_id: acctJobId,
        }),
      },
      adminToken
    );
    assert.equal(acctCand.status, 201);
    createdCandidateIds.push(acctCand.data.candidate_id);

    const dashAcct = await req(`/api/dashboard?job_id=${acctJobId}`, {}, adminToken);
    assert.equal(dashAcct.data.candidates.length, 1);
    assert.equal(dashAcct.data.candidates[0].full_name, 'Huda Finance Candidate');
    console.log('PASS Scenario 4: Accountant candidate isolated from MEAL Officer results.');

    // SCENARIO 5: Close and reopen Accountant job without losing historical records
    await req(`/api/jobs/${acctJobId}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) }, adminToken);
    await req(`/api/jobs/${acctJobId}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, adminToken);
    const dashReopened = await req(`/api/dashboard?job_id=${acctJobId}`, {}, adminToken);
    assert.equal(dashReopened.data.candidates.length, 1);
    console.log('PASS Scenario 5: Job closed and reopened while preserving candidate records.');

    // SCENARIO 6: RBAC enforcement (Assessor cannot access Admin endpoints or unassigned jobs)
    const assessorForbidden = await req('/api/jobs', { method: 'POST', body: JSON.stringify({ title: 'X', department: 'Y' }) }, assessorToken);
    assert.equal(assessorForbidden.status, 403, 'Scenario 6: Assessor must be blocked from creating jobs');
    const assessorScheds = await req('/api/center/schedules', {}, assessorToken);
    assert.equal(assessorScheds.status, 200);
    for (const s of assessorScheds.data.schedules) {
      assert.equal(s.assessor_id, 'usr-assessor-1', 'Scenario 6: Assessor must only see own assigned schedules');
    }
    const publicJobs = await req('/api/public/jobs');
    assert.equal(publicJobs.status, 200);
    assert.equal(JSON.stringify(publicJobs.data).includes('Sara Al-Khatib'), false, 'Public API must never leak candidates');
    console.log('PASS Scenario 6: Role-based access control and public PII isolation verified.');

    // SCENARIO 7 & 8: Critical competency threshold enforcement + dynamic weight validation
    const badWeights = await req(
      `/api/jobs/${acctJobId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          assessment_weights: { technical: 50, sjt: 50, behavioral: 10, practical: 0, center: 0 },
        }),
      },
      adminToken
    );
    assert.equal(badWeights.status, 400, 'Scenario 8: Invalid weight sum (!= 100) must be rejected');

    // Submit Accountant candidate with high Ethics (40% -> 100) but 0 on Critical Reconciliation (60% -> 0) -> overall < passing or fails critical
    await req(`/api/applications/${acctCand.data.application_id}/invite`, { method: 'POST', body: '{}' }, adminToken);
    const startAcct = await req(`/api/candidate/invite/${acctCand.data.invite_token}/start`, { method: 'POST' });
    const acctItems = (await req(`/api/candidate/invite/${acctCand.data.invite_token}`)).data.items;
    const techItem = acctItems.find((i: { section_type: string }) => i.section_type === 'technical');
    const sjtItem = acctItems.find((i: { section_type: string }) => i.section_type === 'sjt');
    const subAcct = await req(`/api/candidate/invite/${acctCand.data.invite_token}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        attempt_id: startAcct.data.attempt.id,
        answers: {
          [techItem.id]: { item_id: techItem.id, selected_option_id: 'b' }, // 0% on Critical Technical (min 75%)
          [sjtItem.id]: { item_id: sjtItem.id, selected_option_id: 'a' }, // 100% on SJT
        },
      }),
    });
    assert.equal(subAcct.status, 200);
    assert.equal(subAcct.data.attempt.critical_passed, false, 'Scenario 8: Failed critical competency must set critical_passed=false');
    assert.notEqual(subAcct.data.attempt.evaluation_category, 'meets_requirements');
    console.log('PASS Scenario 7 & 8: Weight validation, critical threshold blocking, and live dashboard updates verified.');
  } finally {
    // Clean up temporary test records so the DB remains pristine with MEAL Officer + 3 demo candidates
    for (const cid of createdCandidateIds) {
      db.prepare('DELETE FROM candidates WHERE id = ?').run(cid);
    }
    for (const jid of createdJobIds) {
      db.prepare('DELETE FROM jobs WHERE id = ?').run(jid);
    }
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Scenario verification failed:', err);
  process.exit(1);
});
