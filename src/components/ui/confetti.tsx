import { useCallback, useRef } from 'react'

interface ConfettiOptions {
  particleCount?: number
  spread?: number
  startVelocity?: number
  decay?: number
  gravity?: number
  ticks?: number
  colors?: string[]
  origin?: { x: number; y: number }
}

function randomInRange(min: number, max: number) {
  return Math.random() * (max - min) + min
}

export function useConfetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number>(0)

  const fire = useCallback((options: ConfettiOptions = {}) => {
    const {
      particleCount = 50,
      spread = 60,
      startVelocity = 30,
      decay = 0.91,
      gravity = 3,
      ticks = 200,
      colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd', '#01a3a4'],
      origin = { x: 0.5, y: 0.5 },
    } = options

    let canvas = canvasRef.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.style.position = 'fixed'
      canvas.style.inset = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '99999'
      document.body.appendChild(canvas)
      canvasRef.current = canvas
    }

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    interface Particle {
      x: number
      y: number
      vx: number
      vy: number
      w: number
      h: number
      color: string
      rotation: number
      rotationSpeed: number
      life: number
      decay: number
      gravity: number
    }

    const particles: Particle[] = []
    
    for (let i = 0; i < particleCount; i++) {
      const angle = randomInRange(
        (Math.PI / 2) - (spread * Math.PI / 360),
        (Math.PI / 2) + (spread * Math.PI / 360),
      )
      const velocity = randomInRange(startVelocity * 0.5, startVelocity)
      particles.push({
        x: origin.x * canvas.width,
        y: origin.y * canvas.height,
        vx: Math.cos(angle) * velocity * (Math.random() > 0.5 ? 1 : -1),
        vy: -Math.sin(angle) * velocity,
        w: randomInRange(4, 8),
        h: randomInRange(2, 4),
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: randomInRange(0, 360),
        rotationSpeed: randomInRange(-6, 6),
        life: ticks,
        decay,
        gravity,
      })
    }

    cancelAnimationFrame(animFrameRef.current)

    function animate() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      let alive = false
      for (const p of particles) {
        if (p.life <= 0) continue
        alive = true
        p.x += p.vx
        p.vy += p.gravity * 0.1
        p.y += p.vy
        p.vx *= p.decay
        p.vy *= p.decay
        p.rotation += p.rotationSpeed
        p.life--

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate((p.rotation * Math.PI) / 180)
        ctx.globalAlpha = Math.max(0, p.life / ticks)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      if (alive) {
        animFrameRef.current = requestAnimationFrame(animate)
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        canvas.remove()
        canvasRef.current = null
      }
    }

    animate()
  }, [])

  return { fire }
}
