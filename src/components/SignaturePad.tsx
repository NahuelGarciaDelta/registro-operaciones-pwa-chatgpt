import { useEffect, useRef } from 'react'

export default function SignaturePad({ onChange }: { onChange: (data?: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    const resize = () => { const dpr = devicePixelRatio || 1; const rect=c.getBoundingClientRect(); c.width=rect.width*dpr; c.height=180*dpr; ctx.scale(dpr,dpr); ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.strokeStyle='#17211c' }
    resize()
    let drawing=false
    const p=(e:PointerEvent)=>{const r=c.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top] as const}
    const down=(e:PointerEvent)=>{drawing=true;c.setPointerCapture(e.pointerId);const [x,y]=p(e);ctx.beginPath();ctx.moveTo(x,y)}
    const move=(e:PointerEvent)=>{if(!drawing)return;const[x,y]=p(e);ctx.lineTo(x,y);ctx.stroke()}
    const up=()=>{if(!drawing)return;drawing=false;onChange(c.toDataURL('image/png'))}
    c.addEventListener('pointerdown',down); c.addEventListener('pointermove',move); c.addEventListener('pointerup',up); c.addEventListener('pointercancel',up)
    return()=>{c.removeEventListener('pointerdown',down);c.removeEventListener('pointermove',move);c.removeEventListener('pointerup',up);c.removeEventListener('pointercancel',up)}
  },[onChange])
  const clear=()=>{const c=ref.current; const ctx=c?.getContext('2d'); if(c&&ctx){ctx.clearRect(0,0,c.width,c.height);onChange(undefined)}}
  return <div><canvas ref={ref} className="signature"/><button type="button" className="secondary" onClick={clear}>Borrar firma</button></div>
}
