import { useSettings } from '../state/settings';
import { Dialog } from '../ui/controls';

export const DISCLAIMER =
  'Flame is a practice tool. It never places a real order and never holds money. Nothing in it is financial advice. Prices come from public feeds and can be late, missing or wrong; stock prices are 15 minutes behind.';

/** Shown once, on the first visit: what Flame is, and what it is not. */
export function Intro() {
  const seen = useSettings((s) => s.introSeen);
  const patch = useSettings((s) => s.patch);
  if (seen) return null;
  const close = () => patch({ introSeen: true });
  return (
    <Dialog
      title="Flame: real markets, play money"
      onClose={close}
      foot={
        <button type="button" className="btn btn-primary" data-autofocus onClick={close}>
          Open the desk
        </button>
      }
    >
      <div className="intro">
        <p>
          You have a paper account of $100,000. Trade coins, stocks and prediction markets against live prices, with orders that fill the way a real venue fills them: against the book, with fees.
        </p>
        <ul>
          <li>
            <strong>One desk.</strong> Chart, order book, tape and ticket together, so you can watch the book while you place the trade.
          </li>
          <li>
            <strong>Review every trade.</strong> When a position closes, Flame asks for a ten-second note. The Journal shows what is actually working.
          </li>
          <li>
            <strong>Practise on the past.</strong> Replay any day bar by bar, or test a rule on years of history in the Lab.
          </li>
          <li>
            <strong>Nothing to sign up for.</strong> Your account lives in this browser. Export a backup from Settings to keep or move it.
          </li>
        </ul>
        <p>
          Press <kbd>/</kbd> to find a symbol or a command. A question mark beside a number explains it.
        </p>
        <p className="intro-small">{DISCLAIMER}</p>
      </div>
    </Dialog>
  );
}
