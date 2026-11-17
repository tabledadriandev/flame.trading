import { useState } from 'react';
import { instrument } from '../data/instruments';
import type { Review, TradeRec } from '../engine/types';
import { dollars, duration, money, rr, stamp } from '../lib/format';
import { useAccount, type Book } from '../state/account';
import { useSettings } from '../state/settings';
import { PaneState, Segmented, SideTag } from '../ui/controls';

export const EMOTIONS = ['Calm', 'Confident', 'Rushed', 'Fearful', 'Greedy', 'Bored', 'Frustrated'];

export function tradeTitle(t: TradeRec): string {
  const i = instrument(t.instrument);
  return `${i.symbol} ${t.dir}`;
}

/** The result of a trade in one line: P&L, R when there was a stop, and how it ended. */
export function TradeResult({ t }: { t: TradeRec }) {
  const tone = t.pnl >= 0 ? 'hot' : 'cold';
  // With a tight stop, fees can be several times the risk. Show the price result too, so the lesson is visible.
  const gross = t.initialRisk ? t.gross / t.initialRisk : undefined;
  const feesMatter = gross !== undefined && t.r !== undefined && Math.abs(gross - t.r) >= 0.1;
  return (
    <span className="num">
      <span className={tone}>{money(t.pnl, { signed: true })}</span>
      {t.r !== undefined ? <span className={tone}> {rr(t.r)}</span> : null}
      {feesMatter ? <span className="sub"> ({rr(gross)} before fees of {money(t.fees)})</span> : null}
      {t.liquidated ? <span className="sub"> liquidated</span> : null}
      {t.away ? <span className="sub"> while away</span> : null}
    </span>
  );
}

/** The ten-second review: setup, how you felt, did you follow the plan, one line of notes. */
export function ReviewForm({ trade, book = 'live', onDone }: { trade: TradeRec; book?: Book; onDone?: () => void }) {
  const save = useAccount((s) => s.review);
  const setups = useSettings((s) => s.setups);
  const patch = useSettings((s) => s.patch);
  const [setup, setSetup] = useState(trade.review?.setup ?? '');
  const [emotion, setEmotion] = useState(trade.review?.emotion ?? '');
  const [plan, setPlan] = useState<'yes' | 'no' | ''>(trade.review?.followedPlan === true ? 'yes' : trade.review?.followedPlan === false ? 'no' : '');
  const [note, setNote] = useState(trade.review?.note ?? '');
  const [adding, setAdding] = useState('');

  const submit = () => {
    const review: Review = { setup, emotion, followedPlan: plan === '' ? null : plan === 'yes', note: note.trim() };
    save(trade.id, review, book);
    onDone?.();
  };

  return (
    <form
      className="review"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="review-row">
        <label className="field">
          <span className="field-label">Setup</span>
          <span className="field-box">
            <select value={setup} onChange={(e) => setSetup(e.target.value)} data-autofocus>
              <option value="">Not tagged</option>
              {setups.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="field">
          <span className="field-label">New setup tag</span>
          <span className="field-box">
            <input
              value={adding}
              placeholder="Add your own"
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const name = adding.trim();
                if (!name) return;
                if (!setups.includes(name)) patch({ setups: [...setups, name] });
                setSetup(name);
                setAdding('');
              }}
            />
          </span>
        </label>
        <label className="field">
          <span className="field-label">How you felt</span>
          <span className="field-box">
            <select value={emotion} onChange={(e) => setEmotion(e.target.value)}>
              <option value="">Not tagged</option>
              {EMOTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </span>
        </label>
        <div className="field">
          <span className="field-label">Followed the plan</span>
          <Segmented<'yes' | 'no' | ''>
            label="Did you follow the plan"
            value={plan}
            onChange={setPlan}
            tall
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
              { value: '', label: 'No plan' },
            ]}
          />
        </div>
      </div>
      <label className="field">
        <span className="field-label">One line of notes</span>
        <span className="field-box">
          <input value={note} maxLength={280} placeholder="What would you do the same, or differently?" onChange={(e) => setNote(e.target.value)} />
        </span>
      </label>
      <div className="review-foot">
        <button type="submit" className="btn btn-primary">
          Save review
        </button>
      </div>
    </form>
  );
}

/** Closed trades waiting for a note, newest first, each with its form. */
export function ToReview({ book = 'live' }: { book?: Book }) {
  const trades = useAccount((s) => s[book].trades);
  const waiting = trades.filter((t) => t.closedAt !== undefined && !t.review).reverse();
  const [open, setOpen] = useState<string | null>(null);
  if (waiting.length === 0) {
    return <PaneState title="Nothing waiting for a note">When a trade closes it lands here for a ten-second review. Reviewed trades are in the Journal view.</PaneState>;
  }
  const current = open && waiting.some((t) => t.id === open) ? open : waiting[0]!.id;
  return (
    <div className="to-review">
      {waiting.map((t) => (
        <section key={t.id} className="review-card" data-open={t.id === current ? 'true' : undefined}>
          <button type="button" className="review-head" aria-expanded={t.id === current} onClick={() => setOpen(t.id)}>
            <SideTag side={t.dir === 'long' ? 'buy' : 'sell'}>{tradeTitle(t)}</SideTag>
            <TradeResult t={t} />
            <span className="sub num">
              {dollars(t.entryAvg)} to {dollars(t.exitAvg)}, held {duration((t.closedAt ?? t.openedAt) - t.openedAt)}, closed {stamp(t.closedAt ?? t.openedAt)}
            </span>
          </button>
          {t.id === current ? <ReviewForm trade={t} book={book} /> : null}
        </section>
      ))}
    </div>
  );
}
