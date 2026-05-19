const KEYFRAMES = `
@keyframes janus-click-ripple {
  from { r: 30px; opacity: 1; }
  to   { r: 0px;  opacity: 0; }
}
@keyframes janus-drag-trace {
  0%   { stroke-dashoffset: var(--path-len); opacity: 1; }
  75%  { stroke-dashoffset: 0;              opacity: 1; }
  100% { stroke-dashoffset: 0;              opacity: 0; }
}
`

let svg: SVGSVGElement | null = null

export function getOverlay(): SVGSVGElement | null {
  if (!document.body) return null
  if (svg && svg.isConnected) return svg

  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.id = 'janus-replay-overlay'
  svg.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:2147483646',
    'overflow:visible',
  ].join(';')

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = KEYFRAMES
  svg.appendChild(style)

  document.body.appendChild(svg)
  return svg
}
