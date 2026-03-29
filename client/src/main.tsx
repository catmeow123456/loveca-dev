import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

let hasRefreshedForUpdate = false;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasRefreshedForUpdate) return;
    hasRefreshedForUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;

      void registration.update();
      window.setInterval(() => {
        void registration.update();
      }, 60_000);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
