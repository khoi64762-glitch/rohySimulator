import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { analyzeSubTabs } from '@/lib/analyzeTabs';
import { SETTINGS_GROUPS, PIPELINE_SECTIONS } from '@/lib/settingsNav';
import { useSettings, type EditableSettings } from '@/lib/settingsStore';

/*
 * SubNav — the current section's destinations, laid out horizontally.
 *
 * This is the deliberate middle ground between the two things that were both
 * wrong. Five stacked bands was too many LEVELS. Burying the destinations in
 * dropdowns fixed the levels but hid the map: you could no longer see what
 * Analytics or Settings contained without opening something.
 *
 * So: one primary bar, plus ONE contextual row that appears only inside a
 * section that has sub-destinations. Two bands in Analytics and Settings, one
 * everywhere else — against the five we started with — and nothing is hidden.
 *
 * Settings entries wrap rather than scroll. Thirteen items do not fit beside
 * the camera dock on a laptop, and a horizontally scrolling nav row hides
 * destinations behind a gesture with no affordance — exactly the burying this
 * row exists to undo. A second wrapped line is honest and still shows
 * everything.
 */
export function SubNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname.startsWith('/analyze')) return <AnalyticsSubNav pathname={pathname} />;
  if (pathname.startsWith('/settings')) return <SettingsSubNav />;
  return null;
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-line bg-surface-0 px-3 py-1"
    >
      {children}
    </nav>
  );
}

const itemClass = (active: boolean) =>
  cn(
    'rounded-md px-2.5 py-1 text-[13px] transition-colors',
    active
      ? 'bg-status-info-dim font-medium text-status-info'
      : 'text-ink-2 hover:bg-surface-2 hover:text-ink-0',
  );

function AnalyticsSubNav({ pathname }: { pathname: string }) {
  return (
    <Row label="Analytics views">
      {analyzeSubTabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={itemClass(pathname === tab.to)}
          activeProps={{ 'aria-current': 'page' }}
        >
          {tab.label}
        </Link>
      ))}
    </Row>
  );
}

function SettingsSubNav() {
  const navigate = useNavigate();
  const hash = useRouterState({ select: (s) => s.location.hash }).replace(/^#/, '');
  const editable = useSettings();

  const sections = SETTINGS_GROUPS.flatMap((g) => g.sections);
  const active = sections.some((s) => s.id === hash) ? hash : sections[0].id;

  const enabledOf = (key?: string) =>
    key ? Boolean(editable[key as keyof EditableSettings]) : undefined;

  return (
    <Row label="Settings sections">
      {sections.map((section) => {
        const on = enabledOf(section.toggleKey);
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => navigate({ to: '/settings', hash: section.id })}
            aria-current={active === section.id ? 'page' : undefined}
            className={cn(itemClass(active === section.id), 'inline-flex items-center gap-1.5')}
          >
            {/* The dot answers "is this pipeline even on?" without opening the
                section — the one thing the old vertical column was good for. */}
            {on === undefined ? null : (
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  on ? 'bg-status-ok' : 'bg-surface-3 ring-1 ring-inset ring-line-strong',
                )}
                aria-hidden="true"
              />
            )}
            {section.label}
          </button>
        );
      })}
      <span className="ml-auto pl-2 text-[11px] tabular-nums text-ink-3">
        {PIPELINE_SECTIONS.filter((s) => enabledOf(s.toggleKey)).length}/
        {PIPELINE_SECTIONS.length} pipelines on
      </span>
    </Row>
  );
}
