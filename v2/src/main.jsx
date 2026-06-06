import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import InvestmentAdvisor from './InvestmentAdvisor.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <InvestmentAdvisor />
  </StrictMode>,
);
