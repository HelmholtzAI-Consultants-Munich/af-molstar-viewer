import React from 'react';
import ReactDOM from 'react-dom/client';
import 'pdbe-molstar/lib/styles/pdbe-molstar-light.scss';
import { ProjectPage } from './pages/ProjectPage';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProjectPage />
  </React.StrictMode>,
);
