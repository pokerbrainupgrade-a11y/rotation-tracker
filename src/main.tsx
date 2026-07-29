import { render } from 'preact';
import { App } from './app';
import { attachDebugHandle, ensureBooted } from './data/boot';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/dashboard.css';
import './styles/calendar.css';
import './styles/session.css';
import './styles/texture.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app mount point missing from index.html');

async function start(): Promise<void> {
  // DEV-ONLY: apply a visual scenario before the first render so the app boots
  // straight into the state under inspection. `import.meta.env.DEV` is a
  // compile-time constant, so this whole branch is stripped from production.
  if (import.meta.env.DEV) {
    const { readScenario, applyScenario } = await import('./dev/seedStates');
    const scenario = readScenario();
    if (scenario.forceDbError) {
      const { ErrorScreen } = await import('./components/ErrorScreen');
      render(
        <ErrorScreen
          code="INDEXEDDB_OPEN_FAILED"
          message="Simulated storage failure (dev scenario)."
        />,
        root!,
      );
      return;
    }
    if (scenario.name) {
      await ensureBooted();
      await applyScenario(scenario.name);
    }
  }

  render(<App />, root!);

  void ensureBooted();
  attachDebugHandle();
}

void start();
