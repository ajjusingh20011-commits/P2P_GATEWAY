import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import AdminLayout from './layouts/AdminLayout';
import Admin from './pages/Admin.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Traders from './pages/Traders.jsx';
import Merchants from './pages/Merchants.jsx';
import Orders from './pages/Orders.jsx';
import Payments from './pages/Payments.jsx';
import Payouts from './pages/Payouts.jsx';
import Disputes from './pages/Disputes.jsx';
import Smartphones from './pages/Smartphones.jsx';
import Settlement from './pages/Settlement.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Admin />} />

          {/* Authenticated console shell */}
          <Route
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/traders" element={<Traders />} />
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/payouts" element={<Payouts />} />
            <Route path="/disputes" element={<Disputes />} />
            <Route path="/smartphones" element={<Smartphones />} />
            <Route path="/settlement" element={<Settlement />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
