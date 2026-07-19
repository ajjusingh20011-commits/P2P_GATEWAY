import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import MerchantLayout from './layouts/MerchantLayout';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Orders from './pages/Orders.jsx';
import Payouts from './pages/Payouts.jsx';
import Transactions from './pages/Transactions.jsx';
import Balance from './pages/Balance.jsx';
import ApiCredentials from './pages/ApiCredentials.jsx';
import Webhooks from './pages/Webhooks.jsx';
import Profile from './pages/Profile.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Authenticated shell */}
          <Route
            element={
              <ProtectedRoute>
                <MerchantLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/payouts" element={<Payouts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/balance" element={<Balance />} />
            <Route path="/api-credentials" element={<ApiCredentials />} />
            <Route path="/webhooks" element={<Webhooks />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
