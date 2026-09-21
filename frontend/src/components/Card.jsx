export default function Card({ children, className = '', ...rest }) {
  return (
    <div {...rest} className={`bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur ${className}`}>
      {children}
    </div>
  )
}
