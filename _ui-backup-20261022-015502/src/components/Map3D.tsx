import { useState } from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls } from '@react-three/drei'
import { money } from '../lib/format'
import { RISK, formatScore, riskLevel } from '../lib/score'
import { useTheme } from '../lib/theme'

export interface MapPoint3D {
  phone: string
  risk: number
  orders: number
  refused: number
  spend: number
  avgOrderValue: number
  x: number
  y: number
  z: number
  radius: number
}

interface Map3DProps {
  points: MapPoint3D[]
  xLabel: string
  yLabel: string
  zLabel: string
  autoRotate: boolean
  resetKey: number
  axes?: boolean
}

const CENTER: [number, number, number] = [0.5, 0.5, 0.5]
// three.js reads these as WebGL colours, so a CSS var() would not resolve.
// Two sets, chosen from the theme: the brighter website shades on the dark
// ramp, the deeper ones on the light ramp, so the axes stay readable.
const AXIS_KEYS_LIGHT: Array<{ letter: string; color: string; end: [number, number, number]; label: string; labelPos: [number, number, number] }> = [
  { letter: 'X', color: '#BE123C', end: [1, 0, 0], label: '', labelPos: [1.04, -0.03, 0] },
  { letter: 'Y', color: '#0F766E', end: [0, 1, 0], label: '', labelPos: [-0.04, 1.04, 0] },
  { letter: 'Z', color: '#1D4ED8', end: [0, 0, 1], label: '', labelPos: [0, -0.03, 1.04] },
]
const AXIS_KEYS_DARK: typeof AXIS_KEYS_LIGHT = [
  { letter: 'X', color: '#FDA4AF', end: [1, 0, 0], label: '', labelPos: [1.04, -0.03, 0] },
  { letter: 'Y', color: '#2DD4BF', end: [0, 1, 0], label: '', labelPos: [-0.04, 1.04, 0] },
  { letter: 'Z', color: '#93C5FD', end: [0, 0, 1], label: '', labelPos: [0, -0.03, 1.04] },
]

function Dot({ p, onHover }: { p: MapPoint3D; onHover: (p: MapPoint3D | null) => void }) {
  const color = RISK[riskLevel(p.risk)].color
  return (
    <mesh
      position={[p.x, p.y, p.z]}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onHover(p)
      }}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[p.radius, 20, 20]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
    </mesh>
  )
}

export default function Map3D({ points, xLabel, yLabel, zLabel, autoRotate, resetKey, axes = true }: Map3DProps) {
  const [hover, setHover] = useState<MapPoint3D | null>(null)
  const { resolved } = useTheme()
  const dark = resolved === 'dark'
  // three.js reads these as WebGL colours, so a CSS var() would not resolve.
  // Both sets are the website's own values, picked by the current theme.
  const gridColors = dark
    ? { cell: '#141D1F', section: '#F2F6F6' }   // --bg-3, --ink
    : { cell: '#EDF3F3', section: '#0A0F10' }   // --bg-3, --ink
  const axisKeys = dark ? AXIS_KEYS_DARK : AXIS_KEYS_LIGHT

  return (
    <div className="relative h-[420px] w-full sm:h-[500px]">
      <Canvas
        key={resetKey}
        camera={{ position: [2.5, 1.8, 2.9], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <pointLight position={[-3, -2, -3]} intensity={0.35} />

        <Grid
          position={[0.5, 0.005, 0.5]}
          cellSize={0.1}
          sectionSize={0.5}
          cellColor={gridColors.cell}
          sectionColor={gridColors.section}
          fadeDistance={4}
          infiniteGrid
        />

        {axes &&
          axisKeys.map((a) => (
            <group key={a.letter}>
              <Line points={[[0, 0, 0], a.end]} color={a.color} lineWidth={1.4} />
              <Html position={a.labelPos} center>
                <span className="font-mono text-[11px] font-semibold" style={{ color: a.color }}>
                  {a.letter}
                </span>
              </Html>
            </group>
          ))}

        {axes && (
          <Html position={[0.62, 1.06, 0.62]} center>
            <span className="rounded-full border border-border bg-card/90 px-2 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
              {xLabel} · {yLabel} · {zLabel}
            </span>
          </Html>
        )}

        {points.map((p, i) => (
          <Dot key={i} p={p} onHover={setHover} />
        ))}

        <OrbitControls
          makeDefault
          target={CENTER}
          autoRotate={autoRotate}
          autoRotateSpeed={1.8}
          enableDamping
          dampingFactor={0.08}
          minDistance={0.6}
          maxDistance={6}
        />
      </Canvas>

      {hover && (
        <div className="pointer-events-none absolute start-3 top-3 rounded-[10px] border border-border bg-popover/95 px-3 py-2 shadow-2">
          <div className="font-mono text-[12.5px] font-medium text-foreground">{hover.phone}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span
              className="size-2 rounded-full"
              style={{ background: RISK[riskLevel(hover.risk)].color }}
              aria-hidden="true"
            />
            {RISK[riskLevel(hover.risk)].label} · risk {formatScore(hover.risk)}
          </div>
          <div className="text-[12px] text-muted-foreground">
            {hover.orders} order{hover.orders === 1 ? '' : 's'} · {hover.refused} refused
          </div>
          <div className="text-[12px] text-muted-foreground">
            Spend {money(hover.spend)} · avg {money(hover.avgOrderValue)}
          </div>
        </div>
      )}
    </div>
  )
}
