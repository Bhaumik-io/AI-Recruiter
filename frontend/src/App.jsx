import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import SlowNotice from './components/SlowNotice'
import ExamModule from './components/ExamModule'
import { EXAM_ONLY } from './lib/mode'


export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SlowNotice />
        {/* <DevResetButton /> */}
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/hr/login" element={<HRLogin />} />
          <Route path="/hr/dashboard" element={<PrivateRoute role="hr"><HRDashboard /></PrivateRoute>} />
          <Route path="/candidate/login" element={<CandidateLogin />} />
          <Route path="/hr/question-gen" element={<PrivateRoute role="hr"><QuestionGenModule /></PrivateRoute>} />
          <Route path="/candidate/exam" element={<PrivateRoute role="candidate"><CandidateExam /></PrivateRoute>} />
          <Route path="/hr/exam-module" element={<PrivateRoute role="hr"><ExamModule /></PrivateRoute>} />
          {EXAM_ONLY ? (
            <>
              {/* interview + conference are switched off in exam-only mode */}
              <Route path="/candidate/interview" element={<Navigate to="/candidate/exam" replace />} />
              <Route path="/conference/:roomId" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route path="/candidate/interview" element={<PrivateRoute role="candidate"><CandidateInterview /></PrivateRoute>} />
              <Route path="/conference/:roomId" element={<ConferenceRoom />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
