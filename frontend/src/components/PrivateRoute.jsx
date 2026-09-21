import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function PrivateRoute({ role, children }) {
  const { hrToken, candidateToken, candidateRole } = useAuth()

  if (role === 'hr') {
    if (!hrToken) return <Navigate to="/hr/login" replace />
  } else {
    // 'candidate_pre_auth' (password done, face verification still
    // pending) does NOT count as logged in for protected pages.
    if (!candidateToken || candidateRole !== 'candidate') return <Navigate to="/candidate/login" replace />
  }

  return children
}
