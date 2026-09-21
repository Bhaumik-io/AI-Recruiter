import axios from 'axios'

// In dev, Vite proxies /api -> http://localhost:8000 (see vite.config.js).
// In production, set VITE_API_URL to your deployed backend URL and this
// falls back to same-origin '/api' otherwise.
const baseURL = import.meta.env.VITE_API_URL || '/api'

// Two fully separate axios instances, each with its OWN localStorage
// token slot. HR and candidate are different people in real use, but
// during dev/testing it's common to have both logged in in the same
// browser (different tabs) — a single shared 'token' key meant logging
// into one silently logged the other out. Each instance below only
// ever reads/writes its own key, so an HR session and a candidate
// session can coexist in the same browser without clobbering each other.
function makeApi(tokenKey) {
  const instance = axios.create({ baseURL })

  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem(tokenKey)
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        localStorage.removeItem(tokenKey)
      }
      return Promise.reject(err)
    }
  )

  return instance
}

export const hrApi = makeApi('hr_token')
export const candidateApi = makeApi('candidate_token')
