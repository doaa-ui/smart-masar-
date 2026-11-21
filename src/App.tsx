import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Briefcase,
  Sparkles,
  Grid,
  ClipboardList,
  Users,
  FileText,
  CalendarCheck,
  Award,
  BarChart3,
  BookOpen,
  Settings,
  LogOut,
  Globe,
  Menu,
  X,
  Network,
} from 'lucide-react';
import { apiRequest, getAuthToken, setAuthToken } from './lib/api';
import { t } from './i18n/translations';
import type {
  AppLanguage,
  Application,
  Campaign,
  Candidate,
  Job,
  User,
} from './types/domain';
import { AuthAndCareers } from './components/AuthAndCareers';
import { CandidateAssessmentPortal } from './components/CandidateAssessmentPortal';
import { JobsAndAnalysisView } from './components/JobsAndAnalysisView';
import { AssessmentToolsView } from './components/AssessmentToolsView';
import { CandidatesAndAppsView } from './components/CandidatesAndAppsView';
import { AssessmentCenterView } from './components/AssessmentCenterView';
import { DashboardAndReportsView } from './components/DashboardAndReportsView';
import { AssignmentDocsAndSettings } from './components/AssignmentDocsAndSettings';
import { OrgStructureModule } from './components/OrgStructureModule';

const LOGO_URL = '/assets/aistudio/WhatsApp_Image_2026-11-13_at_2.17.28_PM_9e3418f5.jpeg';

type NavKey =
  | 'dashboard'
  | 'jobs'
  | 'analysis'
  | 'competencies'
  | 'assessments'
  | 'candidates'
  | 'applications'
  | 'center'
  | 'results'
  | 'reports'
  | 'org_structure'
  | 'docs'
  | 'settings';

export default function App() {
  const [lang, setLang] = useState<AppLanguage>('ar');
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Preview / Candidate Assessment invite token from URL or admin preview
  const searchParams = new URLSearchParams(window.location.search);
  const urlInvite = searchParams.get('invite') || '';
  const urlView = searchParams.get('view') || '';
  const [previewInviteToken, setPreviewInviteToken] = useState<string>(urlInvite);
  const [previewCareers, setPreviewCareers] = useState<boolean>(false);

  // Shared domain data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    apiRequest<{ user: User }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
        if (res.user.role === 'assessor') {
          setActiveNav('center');
        }
      })
      .catch(() => {
        setAuthToken(null);
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  const refreshAllData = async () => {
    if (!user) return;
    try {
      if (user.role === 'admin') {
        const [jobsRes, campRes, candRes, appsRes, usersRes] = await Promise.all([
          apiRequest<{ jobs: Job[] }>('/api/jobs'),
          apiRequest<{ campaigns: Campaign[] }>('/api/campaigns'),
          apiRequest<{ candidates: Candidate[] }>('/api/candidates?include_archived=true'),
          apiRequest<{ applications: Application[] }>('/api/applications?include_archived=true'),
          apiRequest<{ users: User[] }>('/api/users'),
        ]);
        setJobs(jobsRes.jobs);
        setCampaigns(campRes.campaigns);
        setCandidates(candRes.candidates);
        setApplications(appsRes.applications);
        setUsers(usersRes.users);
        if (!selectedJobId && jobsRes.jobs[0]) {
          setSelectedJobId(jobsRes.jobs[0].id);
        }
      } else if (user.role === 'assessor') {
        const [jobsRes, usersRes] = await Promise.all([
          apiRequest<{ jobs: Job[] }>('/api/jobs'),
          apiRequest<{ users: User[] }>('/api/users'),
        ]);
        setJobs(jobsRes.jobs);
        setUsers(usersRes.users);
        if (!selectedJobId && jobsRes.jobs[0]) {
          setSelectedJobId(jobsRes.jobs[0].id);
        }
      }
    } catch {
      // handled per-view
    }
  };

  useEffect(() => {
    if (!user) return;
    void refreshAllData();
  }, [user?.id, user?.role, activeNav]);

  useEffect(() => {
    if (!user) return;
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshAllData();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [user?.id, user?.role]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setPreviewInviteToken('');
  };

  const toggleLang = () => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'));

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        {t(lang, 'loading')}
      </div>
    );
  }

  // If unauthenticated (or direct URL invite when not logged in)
  if (!user) {
    return (
      <AuthAndCareers
        lang={lang}
        onToggleLang={toggleLang}
        initialInviteToken={urlInvite}
        initialViewMode={urlView === 'careers' ? 'careers' : 'login'}
        onAuthenticated={(u) => {
          setUser(u);
          setActiveNav(u.role === 'assessor' ? 'center' : 'dashboard');
        }}
      />
    );
  }

  // If Admin opened Public Careers Portal preview to submit/test applications
  if (previewCareers) {
    return (
      <AuthAndCareers
        lang={lang}
        onToggleLang={toggleLang}
        initialViewMode="careers"
        adminPreview
        onAuthenticated={(u) => setUser(u)}
        onExitAdminPreview={(goToApplications) => {
          setPreviewCareers(false);
          if (goToApplications) {
            setActiveNav('applications');
          }
          void refreshAllData();
        }}
      />
    );
  }

  // If Admin or Candidate opened an Assessment Invite Portal preview
  if (previewInviteToken) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={LOGO_URL}
              alt="Smart Masar"
              className="h-8 w-8 rounded-lg object-cover border border-slate-200"
              referrerPolicy="no-referrer"
            />
            <span className="font-bold text-slate-900 text-sm">{t(lang, 'brandName')}</span>
          </div>
          <button
            onClick={toggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg"
          >
            <Globe className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
        </header>
        <CandidateAssessmentPortal
          inviteToken={previewInviteToken}
          lang={lang}
          onExit={() => {
            setPreviewInviteToken('');
            void refreshAllData();
          }}
        />
      </div>
    );
  }

  // Candidate logged-in simple portal
  if (user.role === 'candidate') {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={LOGO_URL}
              alt="Smart Masar"
              className="h-9 w-9 rounded-lg object-cover border border-slate-200"
              referrerPolicy="no-referrer"
            />
            <span className="font-bold text-slate-900">{t(lang, 'brandName')}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggleLang} className="px-3 py-1.5 text-xs border rounded-lg">
              {lang === 'ar' ? 'English' : 'العربية'}
            </button>
            <button onClick={handleLogout} className="px-3 py-1.5 text-xs bg-slate-900 text-white rounded-lg">
              {t(lang, 'signOut')}
            </button>
          </div>
        </header>
        <div className="max-w-4xl mx-auto p-6">
          <CandidateAssessmentPortal inviteToken="inv-demo-sara-001" lang={lang} />
        </div>
      </div>
    );
  }

  const adminNavItems: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'dashboard', label: t(lang, 'navDashboard'), icon: LayoutDashboard },
    { key: 'jobs', label: t(lang, 'navJobs'), icon: Briefcase },
    { key: 'analysis', label: t(lang, 'navJobAnalysis'), icon: Sparkles },
    { key: 'competencies', label: t(lang, 'navCompetencies'), icon: Grid },
    { key: 'assessments', label: t(lang, 'navAssessments'), icon: ClipboardList },
    { key: 'candidates', label: t(lang, 'navCandidates'), icon: Users },
    { key: 'applications', label: t(lang, 'navApplications'), icon: FileText },
    { key: 'center', label: t(lang, 'navCenter'), icon: CalendarCheck },
    { key: 'results', label: t(lang, 'navResults'), icon: Award },
    { key: 'reports', label: t(lang, 'navReports'), icon: BarChart3 },
    { key: 'org_structure', label: t(lang, 'navOrgStructure'), icon: Network },
    { key: 'docs', label: t(lang, 'navDocs'), icon: BookOpen },
    { key: 'settings', label: t(lang, 'navSettings'), icon: Settings },
  ];

  const assessorNavItems: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'center', label: t(lang, 'navAssessorWorkspace'), icon: CalendarCheck },
    { key: 'org_structure', label: t(lang, 'navOrgStructure'), icon: Network },
  ];

  const navItems = user.role === 'admin' ? adminNavItems : assessorNavItems;
  const currentNavLabel = navItems.find((n) => n.key === activeNav)?.label || t(lang, 'brandName');

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Navigation (260px fixed on desktop) */}
      <aside
        className={`fixed inset-y-0 start-0 z-40 w-64 bg-[#0B1D3A] text-slate-200 flex flex-col transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : lang === 'ar' ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={LOGO_URL}
              alt="Smart Masar"
              className="h-9 w-9 rounded-lg object-cover bg-white p-0.5 shrink-0"
              referrerPolicy="no-referrer"
            />
            <div className="truncate">
              <div className="font-bold text-white text-sm truncate">{t(lang, 'brandName')}</div>
              <div className="text-[11px] text-cyan-300 truncate">{t(lang, 'brandArabic')}</div>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  setActiveNav(item.key);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3 text-xs">
          <div>
            <div className="font-semibold text-white truncate">
              {lang === 'ar' ? user.name_ar || user.name : user.name}
            </div>
            <div className="text-slate-400 truncate capitalize">
              {user.role} · {user.email}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t(lang, 'signOut')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Top Header Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 text-slate-700"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-semibold text-slate-900 truncate">
              {t(lang, 'brandName')} / {currentNavLabel}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {user.role === 'admin' && (
              <button
                onClick={() => setPreviewCareers(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 rounded-lg whitespace-nowrap"
              >
                <Briefcase className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'بوابة التقديم للوظائف' : 'Public Careers Portal'}
              </button>
            )}
            <button
              onClick={toggleLang}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'English' : 'العربية'}
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1400px] w-full mx-auto">
          {user.role === 'admin' && (activeNav === 'dashboard' || activeNav === 'results' || activeNav === 'reports') && (
            <DashboardAndReportsView
              mode={activeNav}
              jobs={jobs}
              campaigns={campaigns}
              applications={applications.filter((a) => !a.candidate?.archived)}
              lang={lang}
            />
          )}

          {user.role === 'admin' && (activeNav === 'jobs' || activeNav === 'analysis' || activeNav === 'competencies') && (
            <JobsAndAnalysisView
              mode={activeNav}
              jobs={jobs}
              campaigns={campaigns}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
              onRefresh={refreshAllData}
              lang={lang}
            />
          )}

          {user.role === 'admin' && activeNav === 'assessments' && (
            <AssessmentToolsView
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
              lang={lang}
            />
          )}

          {user.role === 'admin' && (activeNav === 'candidates' || activeNav === 'applications') && (
            <CandidatesAndAppsView
              mode={activeNav}
              jobs={jobs}
              candidates={candidates}
              applications={applications}
              onRefresh={refreshAllData}
              onOpenInvitePreview={(token) => setPreviewInviteToken(token)}
              onOpenCareersPortal={() => setPreviewCareers(true)}
              onNavigateToJobs={() => setActiveNav('jobs')}
              lang={lang}
            />
          )}

          {activeNav === 'center' && (
            <AssessmentCenterView
              role={user.role === 'admin' ? 'admin' : 'assessor'}
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
              applications={applications.filter((a) => !a.candidate?.archived)}
              assessors={users}
              onRefresh={refreshAllData}
              lang={lang}
            />
          )}

          {activeNav === 'org_structure' && (user.role === 'admin' || user.role === 'assessor') && (
            <OrgStructureModule lang={lang} onWorkspaceChanged={() => void refreshAllData()} />
          )}

          {user.role === 'admin' && (activeNav === 'docs' || activeNav === 'settings') && (
            <AssignmentDocsAndSettings
              mode={activeNav}
              jobs={jobs}
              users={users}
              onRefresh={refreshAllData}
              lang={lang}
            />
          )}
        </main>
      </div>
    </div>
  );
}
