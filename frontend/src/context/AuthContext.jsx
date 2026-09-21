import { createContext, useContext, useState, useCallback } from 'react'

const AuthContext = createContext(null)

// HR and candidate are tracked as two fully independent sessions (see
// api/client.js for why) — logging into one no longer touches the
// other's localStorage keys or React state.
export function AuthProvider({ children }) {
  const [hrToken, setHrToken] = useState(() => localStorage.getItem('hr_token'))
  const [hrId, setHrId] = useState(() => localStorage.getItem('hr_subjectId'))

  const [candidateToken, setCandidateToken] = useState(() => localStorage.getItem('candidate_token'))
  const [candidateRole, setCandidateRole] = useState(() => localStorage.getItem('candidate_role'))
  const [candidateId, setCandidateId] = useState(() => localStorage.getItem('candidate_subjectId'))

  const loginHR = useCallback((token, id) => {
    localStorage.setItem('hr_token', token)
    localStorage.setItem('hr_subjectId', id)
    setHrToken(token)
    setHrId(id)
  }, [])

  const logoutHR = useCallback(() => {
    localStorage.removeItem('hr_token')
    localStorage.removeItem('hr_subjectId')
    setHrToken(null)
    setHrId(null)
  }, [])

  // role is 'candidate_pre_auth' (password ok, face verification still
  // pending) or 'candidate' (fully logged in).
  const loginCandidate = useCallback((token, role, id) => {
    localStorage.setItem('candidate_token', token)
    localStorage.setItem('candidate_role', role)
    localStorage.setItem('candidate_subjectId', id)
    setCandidateToken(token)
    setCandidateRole(role)
    setCandidateId(id)
  }, [])

  const logoutCandidate = useCallback(() => {
    ['candidate_token', 'candidate_role', 'candidate_subjectId', 'candidatePreAuthId', 'candidateAuthMode']
      .forEach((k) => localStorage.removeItem(k))
    setCandidateToken(null)
    setCandidateRole(null)
    setCandidateId(null)
  }, [])

  return (
    <AuthContext.Provider value={{
      hrToken, hrId, loginHR, logoutHR,
      candidateToken, candidateRole, candidateId, loginCandidate, logoutCandidate,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
