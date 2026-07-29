import { useState } from 'preact/hooks';
import { TabBar } from './components/TabBar';
import { Placeholder } from './screens/Placeholder';
import { SCREEN_COPY } from './screens';
import type { TabId } from './types';

export function App() {
  const [active, setActive] = useState<TabId>('dashboard');
  const copy = SCREEN_COPY[active];

  return (
    <>
      <Placeholder title={copy.title} note={copy.note} />
      <TabBar active={active} onSelect={setActive} />
    </>
  );
}
