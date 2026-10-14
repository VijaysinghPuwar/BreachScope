import { Freshness } from './Freshness';
import type { LiveSource } from '../data/live';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, List, Menu, Search } from 'lucide-react';
import { classNames, dataClasses, type DataClass } from '../data/events';
import { ClassFilters } from './MapControls';
import { Button, Chip, PopoverPanel, SegmentedControl, Tooltip } from './ui';
import { navigation } from '../data/navigation';
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
          <Dropdown.Separator className="menu-divider" />
          <Dropdown.Item asChild>
            <a href="/signin">Sign in</a>
          </Dropdown.Item>
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
}) {
  return (
    <header className="topbar">
      <a href="/" className="wordmark">
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
                  <Button aria-label="Open feed" onClick={onFeed}>
                    <List />
                    Feed
                  </Button>
                  <PopoverPanel
                    label="Data classes"
                    trigger={
                      <Button>
                        Data {classes.length}/6
                        <ChevronDown />
                      </Button>
                    }
                  >
                    <ClassFilters classes={classes} onToggle={onToggleClass} />
                  </PopoverPanel>
                </>
              ) : (
                <div className="class-toggles" aria-label="Data classes">
                  {dataClasses.map((code) => (
                    <Tooltip key={code} content={classNames[code]}>
                      <button
                        className={`class-toggle ${classes.includes(code) ? 'on' : ''}`}
                        type="button"
                        aria-pressed={classes.includes(code)}
                        onClick={() => onToggleClass(code)}
                      >
                        {classes.includes(code) && <Check />}
                        {code}
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
        <Button className="search-button" aria-label="Search events" onClick={onSearch}>
          <Search />
          <span className="search-placeholder">IP, ASN, CVE, country, malware</span>
          <kbd>⌘K</kbd>
        </Button>
        {!mobile && (
          <a href="/signin" className="button button-ghost signin-link">
            Sign in
          </a>
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
