import type { CSSProperties, ComponentType, SVGProps } from 'react'
import {
  AlertCircle,
  ArrowRight,
  AtSign,
  BarChart3,
  Building2,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  CloudOff,
  CloudUpload,
  Compass,
  Copy,
  CreditCard,
  Download,
  FileText,
  Files,
  Fingerprint,
  GitCompareArrows,
  Hourglass,
  Info,
  Layers,
  LogOut,
  MapPin,
  MessageCircle,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Sun,
  Tag,
  Trash2,
  TrendingUp,
  User,
  X,
  XCircle,
  Zap,
} from 'lucide-react'

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>

/**
 * Canonical icon by concept. Each entry is registered under its plain
 * name (e.g. "search"), its "-outline" legacy Ionicons form (e.g.
 * "search-outline"), and any legacy aliases listed alongside.
 */
interface IconEntry {
  cmp: IconComponent
  aliases?: string[]
}

const CANONICAL: Record<string, IconEntry> = {
  add: { cmp: Plus },
  'alert-circle': { cmp: AlertCircle, aliases: ['information-circle', 'information-circle-outline'] },
  'arrow-forward': { cmp: ArrowRight },
  at: { cmp: AtSign },
  'bag-handle': { cmp: ShoppingBag },
  business: { cmp: Building2 },
  calendar: { cmp: Calendar },
  card: { cmp: CreditCard },
  chatbubble: { cmp: MessageCircle },
  chatbubbles: { cmp: MessageSquare },
  check: { cmp: Check, aliases: ['checkmark'] },
  'checkmark-circle': { cmp: CheckCircle2 },
  'checkmark-done': { cmp: CheckCheck },
  clipboard: { cmp: ClipboardList },
  close: { cmp: X, aliases: ['x', 'x-circle', 'x-circle-outline'] },
  'close-circle': { cmp: XCircle },
  'cloud-offline': { cmp: CloudOff },
  'cloud-upload': { cmp: CloudUpload },
  compass: { cmp: Compass },
  copy: { cmp: Copy },
  cube: { cmp: Package },
  'document-text': { cmp: FileText },
  documents: { cmp: Files },
  download: { cmp: Download },
  'ellipsis-horizontal': { cmp: MoreHorizontal },
  fingerprint: { cmp: Fingerprint },
  flash: { cmp: Zap },
  'git-compare': { cmp: GitCompareArrows },
  hourglass: { cmp: Hourglass },
  information: { cmp: Info },
  layers: { cmp: Layers },
  location: { cmp: MapPin, aliases: ['map'] },
  'log-out': { cmp: LogOut },
  moon: { cmp: Moon },
  pencil: { cmp: Pencil },
  person: { cmp: User },
  'phone-portrait': { cmp: Smartphone, aliases: ['smartphone'] },
  pricetags: { cmp: Tag },
  refresh: { cmp: RefreshCw },
  search: { cmp: Search },
  send: { cmp: Send },
  server: { cmp: Server },
  settings: { cmp: Settings },
  'shield-checkmark': { cmp: ShieldCheck },
  sparkles: { cmp: Sparkles },
  star: { cmp: Star },
  'stats-chart': { cmp: BarChart3 },
  storefront: { cmp: Store },
  sunny: { cmp: Sun },
  time: { cmp: Clock },
  trash: { cmp: Trash2 },
  'trending-up': { cmp: TrendingUp },
}

const ICONS: Record<string, IconComponent> = {}
for (const [key, { cmp, aliases }] of Object.entries(CANONICAL)) {
  ICONS[key] = cmp
  ICONS[`${key}-outline`] = cmp
  if (key === 'check') {
    ICONS['checkmark-circle'] = CheckCircle2
    ICONS['checkmark-circle-outline'] = CheckCircle2
    ICONS['checkmark-done'] = CheckCheck
    ICONS['checkmark-done-outline'] = CheckCheck
    ICONS['checkmark-done-circle-outline'] = CheckCheck
  }
  if (key === 'close') {
    ICONS['close-circle'] = XCircle
    ICONS['close-circle-outline'] = XCircle
  }
  if (key === 'information') {
    ICONS['information-circle'] = Info
    ICONS['information-circle-outline'] = Info
  }
  for (const alias of aliases ?? []) ICONS[alias] = cmp
}

interface IconProps {
  name: string
  size?: number | string
  className?: string
  style?: CSSProperties
  color?: string
  strokeWidth?: number
}

export function Icon({ name, size = 18, className, style, color, strokeWidth = 1.75 }: IconProps) {
  const Cmp = ICONS[name] ?? Sparkles
  return (
    <Cmp
      size={size}
      className={className}
      style={style}
      color={color}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  )
}
