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
const AXIS_KEYS: Array<{ letter: string; color: string; end: [number, number, number]; label: string; labelPos: [number, number, number] }> = [
  { letter: 'X', color: '#f87171', end: [1, 0, 0], label: '', labelPos: [1.04, -0.03, 0] },
  { letter: 'Y', color: '#6ee7b7', end: [0, 1, 0], label: '', labelPos: [-0.04, 1.04, 0] },
  { letter: 'Z', color: '#6d8dff', end: [0, 0, 1], label: '', labelPos: [0, -0.03, 1.04] },
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
  const gridColors =
    resolved === 'dark'
      ? { cell: '#1c2a45', section: '#26375a' }
      : { cell: '#dfe7f3', section: '#c3d0e5' }

  return (
    <div className="map3d-wrap">
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
          AXIS_KEYS.map((a) => (
            <group key={a.letter}>
              <Line points={[[0, 0, 0], a.end]} color={a.color} lineWidth={1.4} />
              <Html position={a.labelPos} center>
                <span className="map3d-axis">{a.letter}</span>
              </Html>
            </group>
          ))}

        {axes && (
          <Html position={[0.62, 1.06, 0.62]} center>
            <span className="map3d-axes">{xLabel} · {yLabel} · {zLabel}</span>
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
        <div className="map-tip map3d-tip">
          <div className="map-tip-phone">{hover.phone}</div>
          <div className="map-tip-row">
            <span className="map-tip-dot" style={{ background: RISK[riskLevel(hover.risk)].color }} />
            {RISK[riskLevel(hover.risk)].label} · risk {formatScore(hover.risk)}
          </div>
          <div className="map-tip-row">
            {hover.orders} order{hover.orders === 1 ? '' : 's'} · {hover.refused} refused
          </div>
          <div className="map-tip-row">Spend {money(hover.spend)} · avg {money(hover.avgOrderValue)}</div>
        </div>
      )}
    </div>
  )
}
