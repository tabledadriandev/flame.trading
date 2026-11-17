import { ChartPane } from '../desk/ChartPane';
import { Drawer } from '../desk/Drawer';
import { Ticket } from '../desk/Ticket';
import { Watchlist } from '../desk/Watchlist';
import { useLayout } from '../state/layout';
import { Pane, PaneState } from '../ui/controls';

// The desk is the terminal itself: every pane a trader needs on one screen.

export function Desk() {
  const sizes = useLayout((s) => s.sizes);
  const maximised = useLayout((s) => s.maximised);
  return (
    <div
      className="desk"
      data-max={maximised ?? undefined}
      style={
        {
          '--w-watch': `${sizes.watch}px`,
          '--w-book': `${sizes.book}px`,
          '--w-ticket': `${sizes.ticket}px`,
          '--h-drawer': `${sizes.drawer}px`,
        } as React.CSSProperties
      }
    >
      <Watchlist />
      <ChartPane />
      <Pane label="Book and tape" title="Book" className="pane-book">
        <PaneState title="Not built yet">The heat ladder and the tape arrive in the next phase.</PaneState>
      </Pane>
      <Ticket />
      <Drawer />
    </div>
  );
}
