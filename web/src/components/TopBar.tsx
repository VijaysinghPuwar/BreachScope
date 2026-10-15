import { Freshness } from './Freshness';
import type { LiveSource } from '../data/live';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, CircleHelp, List, Menu, Search } from 'lucide-react';
import { classNames, classShortNames, dataClasses, type DataClass } from '../data/events';
import { ClassFilters } from './MapControls';
import { Button, Chip, PopoverPanel, SegmentedControl, Tooltip } from './ui';
import { navigation } from '../data/navigation';
import { Logo } from './Logo';
export function NavigationMenu() {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button variant="ghost">
          <Menu />
          Menu
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="popover nav-menu" sideOffset={6}>
          {navigation.map(([name, path]) => (
            <Dropdown.Item key={path} asChild>
              <a href={path}>{name}</a>
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function TopBar({
  path,
  mobile,
  tablet,
  sample,
  replay,
  onReplay,
  classes,
  onToggleClass,
  onSearch,
  onFeed,
  status,
  sources,
  now,
  counts,
  onGuide,
}: {
  path: string;
  mobile: boolean;
  tablet: boolean;
  sample: boolean;
  replay: boolean;
  onReplay(value: boolean): void;
  classes: DataClass[];
  onToggleClass(code: DataClass): void;
  onSearch(): void;
  onFeed(): void;
  status: string;
  sources: LiveSource[];
  now: number;
  counts: Partial<Record<DataClass, number>>;
  onGuide(): void;
}) {
  return (
    <header className="topbar">
      <a href="/" className="wordmark">
        <Logo size={22} />
        BreachScope
      </a>
      {!mobile && (
        <>
          {tablet ? (
            <NavigationMenu />
          ) : (
            <nav className="desktop-nav" aria-label="Primary">
              {navigation.map(([name, href]) => (
                <a key={href} href={href} aria-current={href === path ? 'page' : undefined}>
                  {name}
                </a>
              ))}
            </nav>
          )}
          {path === '/' && (
            <>
              <div className="mode-control">
                <SegmentedControl
                  label="Mode"
                  value={replay ? 'Replay' : 'Live'}
                  options={['Live', 'Replay']}
                  onChange={(value) => onReplay(value === 'Replay')}
                />
              </div>
              {tablet ? (
                <>
                  <Button aria-label="Open feed" onClick={onFeed} data-tour="feed">
                    <List />
                    Feed
                  </Button>
                  <PopoverPanel
                    label="Data classes"
                    trigger={
                      <Button data-tour="filters">
                        Data types {classes.filter((c) => c !== 'SIM').length}/5
                        <ChevronDown />
                      </Button>
                    }
                  >
                    <ClassFilters classes={classes} onToggle={onToggleClass} />
                  </PopoverPanel>
                </>
              ) : (
                <div className="class-toggles" aria-label="Data types" data-tour="filters">
                  {dataClasses
                    .filter((code) => code !== 'SIM' || classes.includes('SIM'))
                    .map((code) => (
                      <Tooltip
                        key={code}
                        content={`${classNames[code]} (${code}) · ${(counts[code] ?? 0).toLocaleString('en-US')} records`}
                      >
                        <button
                          className={`class-toggle ${classes.includes(code) ? 'on' : ''}`}
                          type="button"
                          aria-pressed={classes.includes(code)}
                          onClick={() => onToggleClass(code)}
                        >
                          {classes.includes(code) && <Check />}
                          {classShortNames[code]}
                        </button>
                      </Tooltip>
                    ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <div className="topbar-end">
        {classes.includes('SIM') && (
          <Chip>
            <span className="sim-label">Simulated data visible</span>
          </Chip>
        )}
        {path === '/' && (
          <Button
            className="search-button"
            aria-label="Search events"
            onClick={onSearch}
            data-tour="search"
          >
            <Search />
            <span className="search-placeholder">IP, ASN, CVE, country, malware</span>
            <kbd>⌘K</kbd>
          </Button>
        )}
        {path === '/' && (
          <Button
            variant="ghost"
            className="guide-button"
            iconOnly={mobile}
            aria-label={mobile ? 'Open the guide' : undefined}
            onClick={onGuide}
            data-tour="guide"
          >
            <CircleHelp />
            {!mobile && 'Guide'}
          </Button>
        )}
      </div>
      <div className="feed-status">
        {' '}
        <Tooltip content={sample ? 'Live feeds are not connected yet.' : status}>
          <span className="connection">
            <span className="status-dot" />
            {status}
          </span>
        </Tooltip>
        {!sample && <Freshness sources={sources} now={now} />}
      </div>
    </header>
  );
}
