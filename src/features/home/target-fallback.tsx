// Vector fallback for initial loading, failed WebGL and lost contexts.
// Matches the cinematic target palette and its three perfect-10 impacts.
export function TargetFallback() {
  const colors = ["#f4f1e9", "#f4f1e9", "#202020", "#202020", "#49a4cf", "#49a4cf", "#e65a55", "#e65a55", "#f5cf3d", "#f5cf3d"];
  return <svg viewBox="-125 -125 250 250" aria-hidden="true" focusable="false">
    <circle r="122" fill="#796347" stroke="#b79368" strokeWidth="2" />
    {colors.map((fill, index) => <circle key={index} r={116 * (1 - index / 10)} fill={fill} stroke="#332d24" strokeWidth=".5" />)}
    <circle r="5.7" fill="none" stroke="#55421a" strokeWidth=".5" />
    {[{ x: 7.5, y: -1 }, { x: 3.5, y: -6.5 }, { x: -1.5, y: -8 }].map((impact, index) => <g key={index} transform={`translate(${impact.x} ${impact.y}) rotate(8)`}>
      <path d="M-2 0L0 0" stroke="#b79368" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M-58 0H-2" stroke="#25282c" strokeWidth="1.5" />
      <path d="M-58 -.3H-3" stroke="#a8adb1" strokeWidth=".35" />
      <path d="M-50 -.7L-46 -3L-39 -3L-38 -.7ZM-50 .7L-46 3L-39 3L-38 .7Z" fill="#e6b895" stroke="#ba9375" strokeWidth=".3" />
      <path d="M-61 0H-58" stroke="#e6b895" strokeWidth="1.7" strokeLinecap="round" />
    </g>)}
  </svg>;
}
