import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

const host = location.host || 'fengqi.dev';
const origin = location.origin === 'null' ? 'https://' + host : location.origin;

createRoot(root).render(<App host={host} origin={origin} />);
