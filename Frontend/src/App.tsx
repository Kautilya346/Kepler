import { useState, useEffect } from 'react';
import { authenticateDeveloper } from './api';
import { Dashboard } from './components/Dashboard';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authenticateDeveloper()
      .then(() => setIsAuthenticated(true))
      .catch((err) => setError(err.message || 'Failed to connect to API Gateway. Please ensure the backend server is running on port 3001.'));
  }, []);

  if (error) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--bg-main)', color: 'var(--color-error)', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '15px' }}>
        <h2 style={{ fontFamily: 'Outfit' }}>Backend Connection Error</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', maxWidth: '400px', textAlign: 'center', lineHeight: '1.4' }}>{error}</p>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white' }}>
          Retry Connection
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--bg-main)', color: 'white', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '15px' }}>
        <div style={{ width: '30px', height: '30px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'Inter' }}>Connecting to T-Clone API Gateway...</p>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return <Dashboard />;
}

export default App;
