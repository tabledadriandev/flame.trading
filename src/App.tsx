import { Shell } from './shell/Shell';
import { useView } from './lib/route';
import { Desk } from './views/Desk';
import { Plan } from './views/Plan';

export function App() {
  const view = useView();
  return <Shell view={view}>{view === 'desk' ? <Desk /> : <Plan view={view} />}</Shell>;
}
