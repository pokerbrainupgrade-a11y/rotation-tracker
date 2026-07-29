import { render } from 'preact';
import { App } from './app';
import { attachDebugHandle, ensureBooted } from './data/boot';
import './styles/tokens.css';
import './styles/shell.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app mount point missing from index.html');

render(<App />, root);

// Bring the data layer up alongside the shell. Phase 1 renders nothing from it
// — the point is that migrations, seeding and storage persistence actually run
// on the device, so problems surface now rather than once real training data
// exists. Failures are logged and recorded, never thrown at the UI.
void ensureBooted();
attachDebugHandle();
