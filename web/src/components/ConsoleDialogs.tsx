import { ChevronRight, FileText, History, MoreHorizontal, Radio, Search, X } from 'lucide-react';
import type { DataClass, Observation } from '../data/events';
import { navigation } from '../data/navigation';
import { Button, Chip, Modal } from './ui';
import { ClassFilters } from './MapControls';
export function ConsoleDialogs(p: {
  mobile: boolean;
  path: string;
  replay: boolean;
  onReplay(value: boolean): void;
  moreOpen: boolean;
  onMore(value: boolean): void;
  searchOpen: boolean;
  onSearchOpen(value: boolean): void;
  search: string;
  onSearch(value: string): void;
  classes: DataClass[];
  toggleClass(code: DataClass): void;
  events: Observation[];
  onSelect(event: Observation): void;
  openFeed(): void;
}) {
  return (
    <>
      {p.mobile && (
        <nav className="tabbar" aria-label="Mobile navigation">
          <a
            href="/"
            aria-current={p.path === '/' && !p.replay ? 'page' : undefined}
            onClick={(e) => {
              if (p.path === '/') {
                e.preventDefault();
                p.onReplay(false);
              }
            }}
          >
            <Radio />
            Live
          </a>
          <button
            type="button"
            data-tour="timeline"
            aria-pressed={p.replay}
            onClick={() => (p.path === '/' ? p.onReplay(true) : window.location.assign('/'))}
          >
            <History />
            Replay
          </button>
          <a href="/reports" aria-current={p.path === '/reports' ? 'page' : undefined}>
            <FileText />
            Reports
          </a>
          <button type="button" aria-expanded={p.moreOpen} onClick={() => p.onMore(true)}>
            <MoreHorizontal />
            More
          </button>
        </nav>
      )}
      <Modal
        title="Search events"
        open={p.searchOpen}
        onOpenChange={p.onSearchOpen}
        className="search-modal"
      >
        <label className="search-field">
          <Search />
          <span className="sr-only">IP, ASN, CVE, country, malware</span>
          <input
            autoFocus
            placeholder="IP, ASN, CVE, country, malware"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                p.onSearchOpen(false);
                p.openFeed();
              }
            }}
          />
          {p.search && (
            <Button
              iconOnly
              variant="ghost"
              aria-label="Clear search"
              onClick={() => p.onSearch('')}
            >
              <X />
            </Button>
          )}
        </label>
        <h3 className="label text-secondary">Filter</h3>
        <ClassFilters classes={p.classes} onToggle={p.toggleClass} />
        <h3 className="label text-secondary">Jump to</h3>
        <div className="search-results">
          {p.events.slice(0, 6).map((event) => (
            <button
              key={event.event_uid}
              type="button"
              onClick={() => {
                p.onSelect(event);
                p.onSearchOpen(false);
              }}
            >
              <span className="mono">{event.src || event.category}</span>
              <Chip code={event.data_class} />
              <ChevronRight />
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          onClick={() => {
            p.onSearchOpen(false);
            p.openFeed();
          }}
        >
          Feed
        </Button>
      </Modal>
      <Modal title="More" open={p.moreOpen} onOpenChange={p.onMore}>
        <nav className="more-navigation">
          {navigation.slice(1).map(([name, href]) => (
            <a key={href} href={href}>
              {name === 'About' ? 'About the data' : name}
              <ChevronRight />
            </a>
          ))}
        </nav>
      </Modal>
    </>
  );
}
