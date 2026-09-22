import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/studio.css';
import './styles/motion.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
