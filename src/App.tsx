import { Shell } from './shell/Shell';
import { useView } from './lib/route';
import { useAccount } from './state/account';
import { Desk } from './views/Desk';
import { Plan } from './views/Plan';
import { PaneState } from './ui/controls';
import { exportBackup, remove } from './state/persist';
import { takeOver } from './state/boot';

/** Shown instead of the app when the stored account exists but cannot be read. */
function LoadFailed({ error }: { error: string }) {
  return (
    <div className="blocked">
      <PaneState
        title="Your stored account could not be read"
        action={
          <span className="row-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void exportBackup().then((b) => {
                  const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'flame-backup.json';
                  a.click();
                  URL.revokeObjectURL(url);
                });
              }}
            >
              Download what can be read
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (window.confirm('Delete the stored account and start again with $100,000? This cannot be undone.')) {
                  remove('account').then(
                    () => window.location.reload(),
                    (err: unknown) => window.alert(`The stored account could not be deleted. ${err instanceof Error ? err.message : ''} Clearing this site's data in the browser settings will do it.`),
                  );
                }
              }}
            >
              Delete it and start fresh
            </button>
          </span>
        }
      >
        Flame has not changed it. {error} Reloading may help; if it does not, you can start a new account.
      </PaneState>
    </div>
  );
}

/** Shown when another tab or window already has the account open. */
function Elsewhere() {
  return (
    <div className="blocked">
      <PaneState
        title="Flame is open in another tab or window"
        action={
          <button type="button" className="btn btn-primary" onClick={takeOver}>
            Use Flame here instead
          </button>
        }
      >
        One tab at a time runs the paper account, so two copies cannot fill the same order twice or save over each other. Carry on in the other tab, or move it here.
      </PaneState>
    </div>
  );
}

export function App() {
  const view = useView();
  const ready = useAccount((s) => s.ready);
  const loadError = useAccount((s) => s.loadError);
  const elsewhere = useAccount((s) => s.elsewhere);
  if (elsewhere) return <Elsewhere />;
  if (loadError) return <LoadFailed error={loadError} />;
  return (
    <Shell view={view}>
      {!ready ? <PaneState title="Opening your account" /> : view === 'desk' ? <Desk /> : <Plan view={view} />}
    </Shell>
  );
}
