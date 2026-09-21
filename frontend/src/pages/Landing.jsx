import { Link } from 'react-router-dom'
import Card from '../components/Card'

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-12 px-4 py-16">
      <div className="text-center max-w-lg">
        <p className="eyebrow mb-3">Hiring, done properly</p>
        <h1 className="text-5xl font-semibold mb-4">AI Recruiter</h1>
        <div className="w-16 h-px bg-indigo-500/60 mx-auto mb-5" />
        <p className="text-slate-400 leading-relaxed">
          Resume ranking, structured AI interviews, and live proctoring —
          one calm, considered process for every candidate.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
        <Card className="hover:border-indigo-500/50 transition text-left">
          <p className="eyebrow mb-2">For your team</p>
          <h2 className="text-xl font-semibold mb-2">HR</h2>
          <p className="text-sm text-slate-400 mb-6">
            Upload resumes, rank candidates against a role, and review completed interviews.
          </p>
          <Link to="/hr/login"
            className="inline-block w-full text-center px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium transition">
            Continue as HR
          </Link>
        </Card>

        <Card className="hover:border-cyan-500/50 transition text-left">
          <p className="eyebrow mb-2 text-cyan-400/90">For applicants</p>
          <h2 className="text-xl font-semibold mb-2">Candidate</h2>
          <p className="text-sm text-slate-400 mb-6">
            Sign in with your candidate ID to verify your identity and take your interview.
          </p>
          <Link to="/candidate/login"
            className="inline-block w-full text-center px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-medium transition">
            Continue as Candidate
          </Link>
        </Card>
      </div>
    </div>
  )
}
