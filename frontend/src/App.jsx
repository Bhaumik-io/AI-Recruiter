import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import DevResetButton from './components/DevResetButton'
import Landing from './pages/Landing'
import HRLogin from './pages/HRLogin'
import HRDashboard from './pages/HRDashboard'
import CandidateLogin from './pages/CandidateLogin'
import CandidateInterview from './pages/CandidateInterview'
import ConferenceRoom from './pages/ConferenceRoom'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <DevResetButton />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/hr/login" element={<HRLogin />} />
          <Route path="/hr/dashboard" element={<PrivateRoute role="hr"><HRDashboard /></PrivateRoute>} />
          <Route path="/candidate/login" element={<CandidateLogin />} />
          <Route path="/candidate/interview" element={<PrivateRoute role="candidate"><CandidateInterview /></PrivateRoute>} />
          <Route path="/conference/:roomId" element={<ConferenceRoom />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
