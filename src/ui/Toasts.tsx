import { X } from 'lucide-react';
import { useToasts } from '../state/toasts';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" role="log" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-side={t.side}>
          <p>
            {t.side ? <span aria-hidden="true">{t.side === 'buy' ? '▲ ' : '▼ '}</span> : null}
            {t.text}
          </p>
          <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
