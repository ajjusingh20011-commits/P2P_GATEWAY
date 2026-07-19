import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import TraderLayout from './layouts/TraderLayout';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Trades from './pages/Trades.jsx';
import Offers from './pages/Offers.jsx';
import Payouts from './pages/Payouts.jsx';
import BuyUsdt from './pages/BuyUsdt.jsx';
import Notifications from './pages/Notifications.jsx';
import Smartphones from './pages/Smartphones.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Authenticated app shell */}
          <Route
            element={
              <ProtectedRoute>
                <TraderLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/offers" element={<Offers />} />
            <Route path="/buy-usdt" element={<BuyUsdt />} />
            <Route path="/payouts" element={<Payouts />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/smartphones" element={<Smartphones />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
