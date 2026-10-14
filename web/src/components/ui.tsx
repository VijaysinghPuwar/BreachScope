import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, ChevronDown, Inbox, Info, LoaderCircle, X } from 'lucide-react';
import { classNames, severityLabels, type DataClass, type Severity } from '../data/events';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    loading?: boolean;
    iconOnly?: boolean;
  }
>(function Button(
  { variant = 'secondary', loading, iconOnly, className = '', children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`button button-${variant} ${iconOnly ? 'icon-button' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <LoaderCircle className="spin" />}
      {children}
    </button>
  );
});

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange(value: T): void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option, i) => (
        <button
          key={option}
          ref={(element) => {
            buttons.current[i] = element;
          }}
          type="button"
          role="radio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          onClick={() => onChange(option)}
          onKeyDown={(event) => {
            const delta = ['ArrowRight', 'ArrowDown'].includes(event.key)
              ? 1
              : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                ? -1
                : 0;
            if (!delta && !['Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (i + delta + options.length) % options.length;
            onChange(options[next]!);
            buttons.current[next]?.focus();
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  code,
  children,
  onRemove,
}: {
  code?: DataClass;
  children?: ReactNode;
  onRemove?(): void;
}) {
  return (
    <span
      className={`chip ${code ? 'class-badge' : ''}`}
      title={code ? classNames[code] : undefined}
    >
      {code ?? children}
      {onRemove && (
        <button type="button" aria-label="Remove filter" onClick={onRemove}>
          <X />
        </button>
      )}
    </span>
  );
}
export function SeverityGlyph({ level, compact = false }: { level: Severity; compact?: boolean }) {
  return (
    <span className="severity" style={{ '--severity': `var(--sev-${level})` } as CSSProperties}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        {
          [
            <circle
              key="info"
              cx="8"
              cy="8"
              r="5.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />,
            <circle key="low" cx="8" cy="8" r="5.5" />,
            <path key="medium" d="M8 2.25 14.25 13.5H1.75Z" />,
            <path key="high" d="M8 1.25 14.75 8 8 14.75 1.25 8Z" />,
            <rect key="critical" x="2.5" y="2.5" width="11" height="11" />,
          ][level]
        }
      </svg>
      <span className={compact ? 'sr-only' : ''}>{severityLabels[level]}</span>
    </span>
  );
}
export function MetricTile({
  label,
  value,
  delta,
  points,
}: {
  label: string;
  value: string;
  delta: string;
  points: number[];
}) {
  const low = Math.min(...points),
    span = Math.max(...points) - low || 1;
  const spark = points
    .map((p, i) => `${1 + (i / (points.length - 1)) * 70},${22 - ((p - low) / span) * 20}`)
    .join(' ');
  return (
    <div className="metric-tile">
      <span className="caption text-secondary">{label}</span>
      <div className="metric-value">
        <span className="metric">{value}</span>
        <svg width="72" height="24" viewBox="0 0 72 24" aria-hidden="true">
          <polyline points={spark} fill="none" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      </div>
      <span className="metric-delta">
        {delta.startsWith('-') ? <ArrowDown /> : <ArrowUp />}
        {delta}
        <span className="sr-only"> vs previous 15 minutes</span>
      </span>
    </div>
  );
}
export function PanelSection({
  title,
  children,
  count,
}: {
  title: string;
  children: ReactNode;
  count?: number;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="panel-section">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {title}
          {count !== undefined && <span className="text-tertiary">{count}</span>}
          <ChevronDown className={open ? '' : 'rotate-closed'} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="section-content">
        {children}
      </div>
    </section>
  );
}
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="tooltip" sideOffset={6}>
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
export function PopoverPanel({
  trigger,
  label,
  children,
  className = '',
}: {
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          collisionPadding={12}
          align="end"
          aria-label={label}
          className={`popover ${className}`}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function Modal({
  title,
  description,
  open,
  onOpenChange,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          aria-describedby={description ? undefined : undefined}
          className={`modal ${className}`}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" iconOnly aria-label="Close dialog">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          {description && <Dialog.Description>{description}</Dialog.Description>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="banner">
      <Info aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Inbox aria-hidden="true" />
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}
export function Drawer({
  side,
  label,
  children,
}: {
  side: 'left' | 'right';
  label: string;
  children: ReactNode;
}) {
  return (
    <aside className={`drawer drawer-${side}`} aria-label={label}>
      {children}
    </aside>
  );
}
export type SnapPoint = 'peek' | 'half' | 'full';
export function BottomSheet({
  snap,
  onSnap,
  children,
  label,
  portrait = false,
}: {
  snap: SnapPoint;
  onSnap(value: SnapPoint): void;
  children: ReactNode;
  label: string;
  portrait?: boolean;
}) {
  const start = useRef(0);
  const dragging = useRef(false);
  const snaps: SnapPoint[] = ['peek', 'half', 'full'];
  return (
    <section
      className={`bottom-sheet snap-${snap} ${portrait ? 'portrait-sheet' : ''}`}
      aria-label={label}
    >
      <button
        className="sheet-handle"
        type="button"
        aria-label={`Resize sheet, ${snap}`}
        aria-expanded={snap !== 'peek'}
        onClick={() => {
          if (!dragging.current) onSnap(snaps[(snaps.indexOf(snap) + 1) % 3]!);
          dragging.current = false;
        }}
        onPointerDown={(event) => {
          start.current = event.clientY;
          dragging.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          const change = start.current - event.clientY;
          if (Math.abs(change) > 30) {
            dragging.current = true;
            onSnap(snaps[Math.max(0, Math.min(2, snaps.indexOf(snap) + (change > 0 ? 1 : -1)))]!);
          }
        }}
      >
        <span />
      </button>
      <div className="sheet-content">{children}</div>
    </section>
  );
}
