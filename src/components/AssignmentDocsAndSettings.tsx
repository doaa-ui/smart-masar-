import React, { useEffect, useState } from 'react';
import { Printer, Save, UserPlus, ShieldAlert, BookOpen } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AppLanguage,
  AuditLog,
  Job,
  OrganizationSettings,
  User,
  UserRole,
} from '../types/domain';

export const AssignmentDocsAndSettings: React.FC<{
  mode: 'docs' | 'settings';
  jobs: Job[];
  users: User[];
  onRefresh: () => Promise<void>;
  lang: AppLanguage;
}> = ({ mode, jobs, users, onRefresh, lang }) => {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPass, setNewUserPass] = useState('SmartMasar@2026');
  const [newUserRole, setNewUserRole] = useState<UserRole>('assessor');
  const [newUserDept, setNewUserDept] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Editable Group Contribution rows for academic documentation
  const [groupRows, setGroupRows] = useState([
    { member: 'Member 1 / العضو الأول', role: 'Job Analysis & Competency Mapping', contribution: '25%' },
    { member: 'Member 2 / العضو الثاني', role: 'Assessment Tools & Rubrics Design', contribution: '25%' },
    { member: 'Member 3 / العضو الثالث', role: 'Assessment Center & Scoring Rules', contribution: '25%' },
    { member: 'Member 4 / العضو الرابع', role: 'AI Integration, Dashboard & Documentation', contribution: '25%' },
  ]);

  useEffect(() => {
    if (mode === 'settings') {
      apiRequest<{ settings: OrganizationSettings }>('/api/settings')
        .then((r) => setSettings(r.settings))
        .catch(() => {});
      apiRequest<{ logs: AuditLog[] }>('/api/audit-logs')
        .then((r) => setAuditLogs(r.logs))
        .catch(() => {});
    }
  }, [mode]);

  const notify = (text: string) => {
    setMsg(text);
    setErr('');
    setTimeout(() => setMsg(''), 3500);
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    setErr('');
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      notify(lang === 'ar' ? 'تم حفظ إعدادات المنصة' : 'Organization settings saved.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          password: newUserPass,
          role: newUserRole,
          department: newUserDept,
        }),
      });
      setNewUserName('');
      setNewUserEmail('');
      setNewUserDept('');
      await onRefresh();
      notify(lang === 'ar' ? 'تم إنشاء حساب المستخدم بنجاح' : 'User account created.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleToggleUserActive = async (u: User) => {
    try {
      await apiRequest(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !u.active }),
      });
      await onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (mode === 'docs') {
    const mealJob = jobs.find((j) => j.id === 'job-meal-officer') || jobs[0];
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-6 max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-blue-700" />
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {lang === 'ar'
                  ? 'التوثيق الأكاديمي لمنصة مسار الذكي (Smart Masar)'
                  : 'Smart Masar — Academic Assignment Documentation'}
              </h1>
              <p className="text-xs text-slate-500">
                {lang === 'ar'
                  ? 'توثيق قابل للطباعة والتصدير بصيغة PDF يغطي جميع متطلبات المشروع.'
                  : 'Printable and PDF-exportable documentation covering all required academic components.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="no-print inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg"
          >
            <Printer className="w-4 h-4" />
            {lang === 'ar' ? 'طباعة / حفظ كـ PDF' : 'Print / Export PDF'}
          </button>
        </div>

        <section className="space-y-2 text-sm">
          <h2 className="text-base font-bold text-slate-900">1. Job Analysis & Dynamic Multi-Job Architecture</h2>
          <p className="text-slate-700 leading-relaxed">
            Smart Masar separates configuration from source code. Every job position stores its own purpose,
            responsibilities, qualifications, competency matrix (validated to 100%), assessment template,
            assessment center schedule, and candidate applications. The preloaded <strong>{mealJob?.title}</strong>{' '}
            serves as an editable reference case alongside unlimited custom roles (e.g., Accountant, HR Officer).
          </p>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="text-base font-bold text-slate-900">2. Four Competency-Mapped Assessment Tools</h2>
          <ul className="list-disc list-inside text-slate-700 space-y-1">
            <li><strong>Professional / Technical Knowledge Test</strong>: Multiple choice, True/False, Short Answer, and Technical Scenario items mapped to domain competencies.</li>
            <li><strong>Situational Judgment Test (SJT)</strong>: Realistic workplace dilemmas graded via weighted effectiveness options.</li>
            <li><strong>Workplace Behavioral Assessment</strong>: Structured non-diagnostic 5-point Likert items measuring job-relevant behaviors (never clinical/medical diagnoses).</li>
            <li><strong>Practical / Work Sample Assessment</strong>: Hands-on data cleaning, reconciliation, or analytical brief evaluated against a transparent multi-criterion rubric.</li>
          </ul>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="text-base font-bold text-slate-900">3. Assessment Center & Scoring Governance</h2>
          <p className="text-slate-700 leading-relaxed">
            The candidate journey progresses from Application → Screening → Technical Test → SJT → Behavioral → Practical Task → Assessment Center (Structured Interview, Case Study, Role-Play, In-Tray) → Final Human Review.
            Scoring enforces critical competency thresholds: high overall averages cannot bypass a failed critical competency, and final hiring decisions remain strictly human-approved.
          </p>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="text-base font-bold text-slate-900">4. System Architecture & AI Boundaries</h2>
          <p className="text-slate-700 leading-relaxed">
            Built with React 19, TypeScript, Tailwind CSS, Node.js/Express REST API, SQLite relational persistence, protected file uploads, and server-side Google Gemini AI (`gemini-4-hydrogen`). AI assists administrators with drafting job analyses, assessment items, and evidence summaries—requiring human approval before use and never fabricating candidate evidence or making automated hiring decisions.
          </p>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="text-base font-bold text-slate-900">5. Credible Academic & Professional References</h2>
          <ul className="list-disc list-inside text-slate-700 space-y-1 text-xs">
            <li>Society for Industrial and Organizational Psychology (SIOP). (2018). <em>Principles for the Validation and Use of Personnel Selection Procedures</em> (5th ed.).</li>
            <li>Society for Human Resource Management (SHRM). <em>SHRM Body of Applied Skills and Knowledge (BASK) Competency Model</em>.</li>
            <li>CIPD. <em>Assessment Centres & Structured Selection Methods Factsheet</em>.</li>
            <li>CHS Alliance & Sphere Association. <em>Core Humanitarian Standard (CHS) on Quality and Accountability & MEAL Frameworks</em>.</li>
          </ul>
        </section>

        <section className="space-y-3 text-sm">
          <h2 className="text-base font-bold text-slate-900">6. Group Contribution & Task Distribution Template</h2>
          <table className="w-full text-xs border border-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 text-start">Student / Member Name</th>
                <th className="p-2 text-start">Assigned Module / Responsibility</th>
                <th className="p-2 text-center">Contribution %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupRows.map((row, idx) => (
                <tr key={idx}>
                  <td className="p-2">
                    <input
                      value={row.member}
                      onChange={(e) => {
                        const next = [...groupRows];
                        next[idx] = { ...row, member: e.target.value };
                        setGroupRows(next);
                      }}
                      className="w-full border border-slate-200 rounded px-2 py-1"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={row.role}
                      onChange={(e) => {
                        const next = [...groupRows];
                        next[idx] = { ...row, role: e.target.value };
                        setGroupRows(next);
                      }}
                      className="w-full border border-slate-200 rounded px-2 py-1"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <input
                      value={row.contribution}
                      onChange={(e) => {
                        const next = [...groupRows];
                        next[idx] = { ...row, contribution: e.target.value };
                        setGroupRows(next);
                      }}
                      className="w-20 text-center border border-slate-200 rounded px-2 py-1 font-mono"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  // SETTINGS, USERS & AUDIT LOGS
  const wSum = settings
    ? settings.default_assessment_weights.technical +
      settings.default_assessment_weights.sjt +
      settings.default_assessment_weights.behavioral +
      settings.default_assessment_weights.practical +
      settings.default_assessment_weights.center
    : 100;

  return (
    <div className="space-y-6">
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg p-3">{msg}</div>}
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg p-3">{err}</div>}

      {settings && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h2 className="text-base font-bold text-slate-900">
              {lang === 'ar' ? 'إعدادات المؤسسة والتقييم الافتراضية' : 'Organization & Assessment Configuration'}
            </h2>
            <button
              onClick={handleSaveSettings}
              disabled={wSum !== 100}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg"
            >
              <Save className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Organization Name (EN)</label>
              <input
                value={settings.org_name}
                onChange={(e) => setSettings({ ...settings, org_name: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">اسم المؤسسة (AR)</label>
              <input
                value={settings.org_name_ar}
                onChange={(e) => setSettings({ ...settings, org_name_ar: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Data Retention (Days)</label>
              <input
                type="number"
                value={settings.retention_days}
                onChange={(e) => setSettings({ ...settings, retention_days: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Default Assessment Section Weights</span>
              <span className={`font-mono ${wSum === 100 ? 'text-emerald-700' : 'text-rose-700'}`}>
                Sum: {wSum}%
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              {(['technical', 'sjt', 'behavioral', 'practical', 'center'] as const).map((k) => (
                <div key={k}>
                  <label className="block text-slate-500 mb-1 capitalize">{k} (%)</label>
                  <input
                    type="number"
                    value={settings.default_assessment_weights[k]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        default_assessment_weights: {
                          ...settings.default_assessment_weights,
                          [k]: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Users & Permissions Management */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-900">
          {lang === 'ar' ? 'إدارة المستخدمين والصلاحيات' : 'Users & Role Permissions'}
        </h2>
        <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end text-xs">
          <input
            required
            placeholder="Full Name"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <input
            type="email"
            required
            placeholder="Email"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={newUserPass}
            onChange={(e) => setNewUserPass(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <select
            value={newUserRole}
            onChange={(e) => setNewUserRole(e.target.value as UserRole)}
            className="rounded-lg border border-slate-300 px-3 py-2 bg-white"
          >
            <option value="admin">Admin / HR Manager</option>
            <option value="assessor">Assessor / Evaluator</option>
            <option value="candidate">Candidate</option>
          </select>
          <input
            placeholder="Department"
            value={newUserDept}
            onChange={(e) => setNewUserDept(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-slate-900 text-white rounded-lg font-medium"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'إضافة مستخدم' : 'Add User'}
          </button>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-start">Name</th>
                <th className="py-2.5 px-3 text-start">Email</th>
                <th className="py-2.5 px-3 text-start">Role</th>
                <th className="py-2.5 px-3 text-start">Department</th>
                <th className="py-2.5 px-3 text-end">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 px-3 font-medium text-slate-900">{u.name}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-600">{u.email}</td>
                  <td className="py-2.5 px-3 capitalize font-medium text-blue-700">{u.role}</td>
                  <td className="py-2.5 px-3 text-slate-600">{u.department}</td>
                  <td className="py-2.5 px-3 text-end">
                    <button
                      onClick={() => handleToggleUserActive(u)}
                      className={`px-2.5 py-1 rounded border text-xs ${
                        u.active
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {u.active ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit History */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-slate-700" />
          <h2 className="text-base font-bold text-slate-900">
            {lang === 'ar' ? 'سجل التدقيق الإداري والأمني' : 'Administrative Audit History'}
          </h2>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
          {auditLogs.map((log) => (
            <div key={log.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono font-semibold text-slate-800">{log.action}</span> ·{' '}
                <span className="text-slate-600">{log.details}</span>
              </div>
              <div className="font-mono text-slate-400 tabular-nums">
                {log.user_name} ({log.user_role}) · {new Date(log.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
