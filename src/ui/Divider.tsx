import { useRef } from 'react';

/** A draggable pane edge. Arrow keys move it too. */
export function Divider({
  axis,
  value,
  onChange,
  direction = 1,
  label,
  className,
  step = 16,
  scale = 1,
}: {
  /** 'x' sits between side-by-side panes; 'y' between stacked ones. */
  axis: 'x' | 'y';
  value: number;
  onChange: (v: number) => void;
  /** 1 when dragging right/down grows the value, −1 when it shrinks it. */
  direction?: 1 | -1;
  label: string;
  className?: string;
  step?: number;
  /** Value units per pixel (for sizes held as fractions). */
  scale?: number;
}) {
  const start = useRef<{ at: number; value: number } | null>(null);
  return (
    <div
      className={`divider divider-${axis}${className ? ` ${className}` : ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value * 100) / 100}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { at: axis === 'x' ? e.clientX : e.clientY, value };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const now = axis === 'x' ? e.clientX : e.clientY;
        onChange(start.current.value + (now - start.current.at) * direction * scale);
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onKeyDown={(e) => {
        const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        if (e.key === grow) {
          e.preventDefault();
          onChange(value + step * direction * scale);
        } else if (e.key === shrink) {
          e.preventDefault();
          onChange(value - step * direction * scale);
        }
      }}
    />
  );
}
