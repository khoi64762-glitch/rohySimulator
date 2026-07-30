import { Link, useRouterState } from '@tanstack/react-router';
import {
  BarChart3,
  Camera,
  FlaskConical,
  HelpCircle,
  Info,
  ListChecks,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Brand } from './Brand';
import { MenuPopover } from './MenuPopover';
import { FilterControls } from './FilterBar';
import { SessionContextPanel } from './SessionContextPanel';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { useCameraDock } from '@/lib/CameraDockContext';

/*
 * TopMenu — the app's ONE bar.
 *
 * It replaces five stacked bands that between them ate ~194 px before any
 * content appeared:
 *
 *   TopBar        brand + 8 session-context pills   -> "Session" popover
 *   TopMenu       5 workflow links                  -> stays, inline
 *   FilterBar     scope / sessions / users          -> "Scope" popover
 *   PageHeader    eyebrow + title + description     -> deleted
 *   domain tabs   9 Analytics domains               -> <SubNav>, contextual
 *
 * The principle: a band earns permanent vertical space only if you look at it
 * on most screens. Session provenance and filter scope do not — they are
 * reference material, needed sometimes and read rarely, so they became
 * triggers costing one click and no pixels.
 *
 * NAVIGATION is the exception, and it stays visible. Analytics and Settings
 * are plain links here; their destinations appear in a horizontal <SubNav>
 * row beneath this bar while you are inside them. Putting them in dropdowns
 * fixed the level count but hid the map — you could no longer see what a
 * section contained without opening something. Two bands inside those
 * sections, one everywhere else.
 */

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/*
 * "Analytics", not "Analyze" — the section is a place you go to look at
 * results, not an action you perform. The ROUTE stays /analyze so every
 * existing deep link keeps working.
 */
const ITEMS: ReadonlyArray<NavItem> = [
  { to: '/live', label: 'Live', icon: Sparkles },
  { to: '/analyze', label: 'Analytics', icon: BarChart3 },
  { to: '/sessions', label: 'Sessions', icon: ListChecks },
  { to: '/diagnostics', label: 'Diagnostics', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help', icon: HelpCircle },
  { to: '/about', label: 'About', icon: Info },
];

export function TopMenu() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const cameraDock = useCameraDock();
  // Scope only means something where stored windows are rendered.
  const showScope =
    pathname.startsWith('/analyze') || pathname.startsWith('/sessions');

  return (
    <header
      className="flex items-center gap-2 border-b border-line bg-surface-1 px-3 py-1.5"
      role="banner"
    >
      <Brand compact />

      <nav aria-label="Main" className="flex items-center gap-0.5">
        {ITEMS.map((item) => (
          <NavLink key={item.to} item={item} pathname={pathname} />
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        {showScope ? <ScopeMenu /> : null}
        <button
          type="button"
          onClick={() => cameraDock.setVisible((visible) => !visible)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
            cameraDock.visible
              ? 'text-ink-1 hover:bg-surface-2'
              : 'bg-status-info-dim font-medium text-status-info hover:brightness-110',
          )}
          aria-label={cameraDock.visible ? 'Hide camera preview' : 'Show camera preview'}
          aria-pressed={cameraDock.visible}
          title={cameraDock.visible ? 'Hide camera preview' : 'Show camera preview'}
        >
          <Camera className="size-4" aria-hidden="true" />
          <span>Preview</span>
        </button>
        <MenuPopover
          label="Session"
          icon={<UserRound className="size-4" aria-hidden="true" />}
          align="right"
          panelClassName="w-[22rem] p-3"
        >
          {() => <SessionContextPanel />}
        </MenuPopover>
      </div>
    </header>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <Link
      to={item.to}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
        active
          ? 'bg-status-info-dim font-medium text-status-info'
          : 'text-ink-1 hover:bg-surface-2',
      )}
      activeProps={{ 'aria-current': 'page' }}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

/*
 * The window count stays on the TRIGGER, not inside the panel. It is the one
 * number from the old filter bar worth seeing without asking: it says whether
 * a filter is hiding data, which is precisely the state in which you would
 * otherwise misread a dashboard.
 */
function ScopeMenu() {
  const { allWindows, filtered } = useFilteredWindows();
  const narrowed = filtered.length !== allWindows.length;

  return (
    <MenuPopover
      align="right"
      panelClassName="w-[26rem] p-2.5"
      active={narrowed}
      ariaLabel="Scope and filters"
      icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
      label={
        <span className="tabular-nums">
          {narrowed
            ? `${filtered.length} / ${allWindows.length}`
            : allWindows.length}{' '}
          windows
        </span>
      }
    >
      {() => (
        <div className="flex flex-wrap items-center gap-2">
          <FilterControls compact />
        </div>
      )}
    </MenuPopover>
  );
}
