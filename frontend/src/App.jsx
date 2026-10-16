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
import QuestionGenModule from './components/QuestionGenModule'
import CandidateExam from './components/CandidateExam'
import ExamModule from './components/ExamModule'


export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {/* <DevResetButton /> */}
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/hr/login" element={<HRLogin />} />
          <Route path="/hr/dashboard" element={<PrivateRoute role="hr"><HRDashboard /></PrivateRoute>} />
          <Route path="/candidate/login" element={<CandidateLogin />} />
          <Route path="/candidate/interview" element={<PrivateRoute role="candidate"><CandidateInterview /></PrivateRoute>} />
          <Route path="/hr/question-gen" element={<PrivateRoute role="hr"><QuestionGenModule /></PrivateRoute>} />
          <Route path="/candidate/exam" element={<PrivateRoute role="candidate"><CandidateExam /></PrivateRoute>} />
          <Route path="/hr/exam-module" element={<PrivateRoute role="hr"><ExamModule /></PrivateRoute>} />
          <Route path="/conference/:roomId" element={<ConferenceRoom />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
